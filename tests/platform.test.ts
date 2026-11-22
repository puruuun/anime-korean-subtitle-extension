import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  detectBrowserFamily,
  openExtensionManager,
  safeSetAccessLevel,
  sendTabMessageSafe,
} from '../src/platform/browser';

describe('detectBrowserFamily', () => {
  it('prefers runtimeUrl scheme over userAgent', () => {
    expect(detectBrowserFamily('Mozilla/5.0 Chrome/120', 'moz-extension://abc/')).toBe('firefox');
    expect(detectBrowserFamily('Mozilla/5.0 Chrome/120', 'safari-web-extension://abc/')).toBe(
      'safari',
    );
    expect(detectBrowserFamily('Mozilla/5.0 Firefox/128.0', 'chrome-extension://abc/')).toBe(
      'chrome',
    );
  });

  it('falls back to userAgent when runtimeUrl is absent', () => {
    expect(
      detectBrowserFamily('Mozilla/5.0 (Windows NT 10.0; rv:128.0) Gecko/20100101 Firefox/128.0', ''),
    ).toBe('firefox');
    expect(
      detectBrowserFamily(
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
        '',
      ),
    ).toBe('safari');
    expect(
      detectBrowserFamily(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
        '',
      ),
    ).toBe('chrome');
    expect(
      detectBrowserFamily(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36 Edg/125.0.0.0',
        '',
      ),
    ).toBe('chrome');
  });
});

describe('safeSetAccessLevel', () => {
  it('calls setAccessLevel when supported', async () => {
    const setAccessLevel = vi.fn().mockResolvedValue(undefined);
    await safeSetAccessLevel({ setAccessLevel }, 'TRUSTED_CONTEXTS');
    expect(setAccessLevel).toHaveBeenCalledWith({ accessLevel: 'TRUSTED_CONTEXTS' });
  });

  it('resolves cleanly when area or setAccessLevel is undefined', async () => {
    await expect(safeSetAccessLevel(undefined, 'TRUSTED_CONTEXTS')).resolves.toBeUndefined();
    await expect(safeSetAccessLevel({}, 'TRUSTED_CONTEXTS')).resolves.toBeUndefined();
  });

  it('propagates errors when setAccessLevel exists and rejects', async () => {
    const setAccessLevel = vi.fn().mockRejectedValue(new Error('storage failure'));
    await expect(safeSetAccessLevel({ setAccessLevel }, 'TRUSTED_CONTEXTS')).rejects.toThrow(
      'storage failure',
    );
  });
});

describe('sendTabMessageSafe', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('calls sendMessage without documentId when omitted', async () => {
    const sendMessage = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('chrome', { tabs: { sendMessage } });

    const res = await sendTabMessageSafe(10, { type: 'PING' }, { frameId: 2 });
    expect(res).toEqual({ ok: true });
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage).toHaveBeenCalledWith(10, { type: 'PING' }, { frameId: 2 });
  });

  it('passes documentId when supported', async () => {
    const sendMessage = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('chrome', { tabs: { sendMessage } });

    const res = await sendTabMessageSafe(10, { type: 'APPLY' }, { frameId: 2, documentId: 'doc-1' });
    expect(res).toEqual({ ok: true });
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage).toHaveBeenCalledWith(
      10,
      { type: 'APPLY' },
      { frameId: 2, documentId: 'doc-1' },
    );
  });

  it('retries without documentId on TypeError or documentId schema error', async () => {
    const sendMessage = vi
      .fn()
      .mockImplementationOnce(() => {
        throw new TypeError('Unexpected property "documentId"');
      })
      .mockResolvedValueOnce({ ok: true });
    vi.stubGlobal('chrome', { tabs: { sendMessage } });

    const res = await sendTabMessageSafe(10, { type: 'APPLY' }, { frameId: 3, documentId: 'doc-1' });
    expect(res).toEqual({ ok: true });
    expect(sendMessage).toHaveBeenCalledTimes(2);
    expect(sendMessage).toHaveBeenNthCalledWith(
      1,
      10,
      { type: 'APPLY' },
      { frameId: 3, documentId: 'doc-1' },
    );
    expect(sendMessage).toHaveBeenNthCalledWith(2, 10, { type: 'APPLY' }, { frameId: 3 });

    const sendMessageAsync = vi
      .fn()
      .mockRejectedValueOnce(new Error('Invalid option: documentId is not supported'))
      .mockResolvedValueOnce({ ok: true });
    vi.stubGlobal('chrome', { tabs: { sendMessage: sendMessageAsync } });

    const res2 = await sendTabMessageSafe(
      11,
      { type: 'APPLY' },
      { frameId: 4, documentId: 'doc-2' },
    );
    expect(res2).toEqual({ ok: true });
    expect(sendMessageAsync).toHaveBeenCalledTimes(2);
  });

  it('does not retry on unrelated runtime errors', async () => {
    const sendMessage = vi
      .fn()
      .mockRejectedValue(new Error('Could not establish connection. Receiving end does not exist.'));
    vi.stubGlobal('chrome', { tabs: { sendMessage } });

    await expect(
      sendTabMessageSafe(10, { type: 'APPLY' }, { frameId: 2, documentId: 'doc-1' }),
    ).rejects.toThrow('Receiving end does not exist');
    expect(sendMessage).toHaveBeenCalledTimes(1);
  });
});

describe('openExtensionManager', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('opens chrome://extensions on chrome', async () => {
    const create = vi.fn().mockResolvedValue({});
    vi.stubGlobal('chrome', {
      runtime: { id: 'ext-123', getURL: () => 'chrome-extension://ext-123/' },
      tabs: { create },
    });

    await openExtensionManager();
    expect(create).toHaveBeenCalledWith({ url: 'chrome://extensions/?id=ext-123' });
  });

  it('opens about:addons on firefox', async () => {
    const create = vi.fn().mockResolvedValue({});
    vi.stubGlobal('chrome', {
      runtime: { id: 'ext-123', getURL: () => 'moz-extension://uuid/' },
      tabs: { create },
    });

    await openExtensionManager();
    expect(create).toHaveBeenCalledWith({ url: 'about:addons' });
  });

  it('calls openOptionsPage on safari and no-ops safely if unavailable', async () => {
    const openOptionsPage = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('chrome', {
      runtime: { id: 'ext-123', getURL: () => 'safari-web-extension://uuid/', openOptionsPage },
      tabs: { create: vi.fn() },
    });

    await openExtensionManager();
    expect(openOptionsPage).toHaveBeenCalledTimes(1);

    vi.stubGlobal('chrome', {
      runtime: { id: 'ext-123', getURL: () => 'safari-web-extension://uuid/' },
      tabs: { create: vi.fn() },
    });
    await expect(openExtensionManager()).resolves.toBeUndefined();
  });
});
