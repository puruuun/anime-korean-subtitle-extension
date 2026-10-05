import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
let updates: typeof import('../src/background/updates');
let store: Record<string, unknown>, version: string;
const fetchMock = vi.fn<typeof fetch>();
const contains = vi.fn(async () => true),
  request = vi.fn();
function release(tag = 'v0.5.1', extra: Record<string, unknown> = {}) {
  return new Response(
    JSON.stringify({
      tag_name: tag,
      name: 'Release ' + tag,
      draft: false,
      prerelease: false,
      html_url: 'https://malicious.example',
      ...extra,
    }),
  );
}
beforeEach(async () => {
  vi.resetModules();
  store = {};
  version = '0.5.1';
  fetchMock.mockReset();
  contains.mockReset().mockResolvedValue(true);
  request.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('chrome', {
    runtime: { getManifest: () => ({ version }) },
    permissions: { contains, request },
    storage: {
      local: {
        get: async (keys: string | string[]) =>
          Object.fromEntries((typeof keys === 'string' ? [keys] : keys).map((k) => [k, store[k]])),
        set: async (values: Record<string, unknown>) => {
          Object.assign(store, structuredClone(values));
        },
        remove: async (key: string) => {
          delete store[key];
        },
      },
    },
  });
  updates = await import('../src/background/updates');
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
describe('GitHub Release update checks', () => {
  it.each([
    ['v0.5.1', '0.5.1'],
    ['0.5.10', '0.5.10'],
    ['v1.2.3.4', '1.2.3.4'],
    ['nightly', undefined],
    ['v1.2.3-rc1', undefined],
    ['v1.2.3.4.5', undefined],
    ['v65536.0', undefined],
  ])('only compares Chrome-compatible release tags: %s', (tag, expected) => {
    expect(updates.releaseVersion(tag)).toBe(expected);
  });
  it.each([
    ['0.5.9', '0.5.10', -1],
    ['1.2.3', '1.2.3.0', 0],
    ['1.2.4', '1.2.3.9', 1],
  ])('compares %s and %s numerically', (left, right, expected) => {
    expect(updates.compareVersions(left, right)).toBe(expected);
  });
  it.each([
    ['v0.5.1', 'latest'],
    ['v0.5.2', 'available'],
    ['v0.5.0', 'ahead'],
  ])('reports correct status for %s', async (tag, state) => {
    fetchMock.mockResolvedValue(release(tag));
    const status = await updates.checkUpdates();
    expect(status).toMatchObject({
      state,
      currentVersion: '0.5.1',
      latestVersion: tag.slice(1),
      releaseUrl: updates.RELEASES_URL + '/tag/' + tag,
    });
    expect(request).not.toHaveBeenCalled();
  });
  it('queries without authentication for public repositories and never trusts an API-provided external URL', async () => {
    fetchMock.mockResolvedValue(release());
    await updates.checkUpdates();
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe(updates.LATEST_RELEASE_API);
    expect(options).toMatchObject({
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      redirect: 'error',
    });
    expect(options!.headers).not.toHaveProperty('Authorization');
    expect((await updates.checkUpdates()).releaseUrl).not.toContain('malicious');
  });
  it('stores credentials separately, exposes only connection status and clears cache on disconnect', async () => {
    store.settings = { translation: { model: 'keep-this' } };
    expect(await updates.saveUpdateToken(' github_pat_test ')).toEqual({ tokenConfigured: true });
    expect(await updates.updateConnection()).toEqual({ tokenConfigured: true });
    fetchMock.mockResolvedValue(release());
    const status = await updates.checkUpdates();
    expect(fetchMock.mock.calls[0][1]!.headers).toHaveProperty(
      'Authorization',
      'Bearer github_pat_test',
    );
    expect(JSON.stringify(status)).not.toContain('github_pat_test');
    expect(store.settings).toEqual({ translation: { model: 'keep-this' } });
    expect(await updates.saveUpdateToken('')).toEqual({ tokenConfigured: false });
    expect(store).not.toHaveProperty('githubUpdateToken');
    expect(store).not.toHaveProperty('githubUpdateCheck');
  });
  it('rejects malformed credentials with actionable validation', async () => {
    await expect(updates.saveUpdateToken('bad token')).rejects.toThrow('토큰 형식');
    await expect(updates.saveUpdateToken(12)).rejects.toThrow('토큰 형식');
    expect(store).not.toHaveProperty('githubUpdateToken');
  });
  it('caches successful checks, recalculates after installation and explicitly refreshes', async () => {
    fetchMock.mockResolvedValue(release('v0.5.2'));
    expect((await updates.checkUpdates()).state).toBe('available');
    version = '0.5.2';
    expect(await updates.checkUpdates()).toMatchObject({
      state: 'latest',
      currentVersion: '0.5.2',
      cached: true,
    });
    expect(fetchMock).toHaveBeenCalledOnce();
    await updates.checkUpdates(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 601000);
    await updates.checkUpdates();
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
  it('shares concurrent checks rather than duplicate GitHub calls', async () => {
    let finish!: (value: Response) => void;
    fetchMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const first = updates.checkUpdates(true),
      second = updates.checkUpdates(true);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    finish(release());
    expect(await first).toEqual(await second);
  });
  it.each([
    [404, {}, '토큰을 연결'],
    [401, {}, '인증에 실패'],
    [403, {}, '읽기 권한'],
    [403, { 'x-ratelimit-remaining': '0' }, '요청 한도'],
    [429, {}, '요청 한도'],
    [500, {}, 'HTTP 500'],
  ])('never reports latest after HTTP %s', async (code, headers, message) => {
    fetchMock.mockResolvedValue(
      new Response('{}', { status: code as number, headers: headers as Record<string, string> }),
    );
    const status = await updates.checkUpdates();
    expect(status.state).toBe('error');
    expect(status.latestVersion).toBeUndefined();
    expect(status.message).toContain(message);
  });
  it('explains authenticated 404 separately from missing credentials', async () => {
    await updates.saveUpdateToken('github_pat_test');
    fetchMock.mockResolvedValue(new Response('{}', { status: 404 }));
    expect((await updates.checkUpdates()).message).toContain('저장소 선택');
  });
  it.each([{ prerelease: true }, { draft: true }, { tag_name: 'nightly' }])(
    'refuses invalid or unpublished Release data: %o',
    async (extra) => {
      fetchMock.mockResolvedValue(release('v0.5.1', extra));
      expect((await updates.checkUpdates()).state).toBe('error');
    },
  );
  it('shows Chrome access guidance without opening a runtime permission request', async () => {
    contains.mockResolvedValue(false);
    const status = await updates.checkUpdates();
    expect(status.state).toBe('error');
    expect(status.message).toContain('권한 가이드');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
  });
  it('does not falsely label an offline check as current', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    expect(await updates.checkUpdates()).toMatchObject({
      state: 'error',
      message: expect.stringContaining('인터넷 연결'),
    });
  });
  it('aborts an old authenticated request when the token changes and never caches its result', async () => {
    await updates.saveUpdateToken('old-test-token');
    fetchMock.mockImplementation(
      (_url, options) =>
        new Promise((_resolve, reject) =>
          options!.signal!.addEventListener('abort', () =>
            reject(new DOMException('Aborted', 'AbortError')),
          ),
        ),
    );
    const old = updates.checkUpdates(true);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    await updates.saveUpdateToken('new-test-token');
    expect((await old).state).toBe('error');
    expect(store).not.toHaveProperty('githubUpdateCheck');
    fetchMock.mockResolvedValue(release('v0.5.2'));
    expect((await updates.checkUpdates()).state).toBe('available');
    expect(fetchMock.mock.calls[1][1]!.headers).toHaveProperty(
      'Authorization',
      'Bearer new-test-token',
    );
  });
  it('stops a hanging check after ten seconds', async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementation(
      (_url, options) =>
        new Promise((_resolve, reject) =>
          options!.signal!.addEventListener('abort', () =>
            reject(new DOMException('Aborted', 'AbortError')),
          ),
        ),
    );
    const checking = updates.checkUpdates(true);
    await vi.advanceTimersByTimeAsync(10000);
    expect(await checking).toMatchObject({
      state: 'error',
      message: expect.stringContaining('시간이 초과'),
    });
    expect(store).not.toHaveProperty('githubUpdateCheck');
  });
});
