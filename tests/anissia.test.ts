import { describe, it, expect, vi, afterEach } from 'vitest';
import 'fake-indexeddb/auto';
import { AnissiaProvider, ANISSIA_SCHEDULE_TTL } from '../src/providers/anissia/AnissiaProvider';
import { matchAnissiaTitle } from '../src/providers/anissia/titleMatching';
import { normalizeEpisode } from '../src/anime/episodeNormalizer';
import { Database } from '../src/storage/database';
import { createProviders } from '../src/providers/createProviders';
import { defaultSettings } from '../src/storage/settings';
import { SubtitleLinkResolverChain } from '../src/subtitle/links/SubtitleLinkResolverChain';
import { SubtitleLinkUnavailable } from '../src/subtitle/links/SubtitleLinkResolver';

const context = {
  site: 'miruro' as const,
  title: 'Test Show',
  nativeTitle: 'テスト ショー',
  episode: 12.5,
  pageUrl: 'https://www.miruro.to/watch/test',
};
const anime = {
  animeNo: 42,
  subject: '테스트 쇼',
  originalSubject: 'テスト・ショー',
  startDate: '2026-07-05',
  endDate: '2026-10-04',
};
const caption = {
  episode: '012.50',
  name: '제작자 A',
  website: 'https://blog.example/entry/12',
  updDt: '2026-10-01T02:30:00',
};
const json = (value: unknown) =>
  new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } });
afterEach(() => vi.unstubAllGlobals());

describe('decimal episode and normalized titles', () => {
  it('uses schedule dates to avoid matching a same-title remake outside the context year', () => {
    expect(matchAnissiaTitle({ ...context, year: 2020 }, anime)).toBeUndefined();
    expect(matchAnissiaTitle({ ...context, year: 2027 }, anime)).toBeUndefined();
    expect(matchAnissiaTitle({ ...context, year: 2026 }, anime)).toBe(context.nativeTitle);
    expect(matchAnissiaTitle({ ...context, year: 2027 }, { ...anime, endDate: '' })).toBe(
      context.nativeTitle,
    );
  });
  it('normalizes numeric strings without losing decimal precision or special episode identity', () => {
    expect(normalizeEpisode(' EP ００１２.５００ ')).toBe('12.5');
    expect(normalizeEpisode('第012.50話')).toBe('12.5');
    expect(normalizeEpisode('000')).toBe('0');
    expect(normalizeEpisode('.50')).toBe('0.5');
    expect(normalizeEpisode(12.5)).toBe('12.5');
    expect(normalizeEpisode('12.500000000000000001')).toBe('12.500000000000000001');
    for (const value of ['12-13', 'SP12', '1e2', '-1', '12.5 extra', ''])
      expect(normalizeEpisode(value)).toBeUndefined();
  });
  it('matches flat and nested title aliases across punctuation and spacing', () => {
    expect(matchAnissiaTitle(context, anime)).toBe(context.nativeTitle);
    for (const key of ['title', 'englishTitle', 'romajiTitle', 'nativeTitle']) {
      expect(
        matchAnissiaTitle(
          { ...context, title: 'unrelated', nativeTitle: undefined, [key]: 'TEST: show!' },
          { ...anime, subject: 'Test Show' },
        ),
      ).toBe('TEST: show!');
    }
    expect(
      matchAnissiaTitle({ ...context, nativeTitle: undefined, synonyms: ['테스트 쇼'] }, anime),
    ).toBe('테스트 쇼');
    expect(
      matchAnissiaTitle(
        { ...context, nativeTitle: undefined, titles: { synonyms: ['テストショー'] } },
        anime,
      ),
    ).toBe('テストショー');
  });
  it('keeps seasons distinct while matching Korean and Japanese season notation', () => {
    const season2 = { ...anime, subject: '테스트 쇼 2기', originalSubject: 'テストショー 第2期' };
    expect(matchAnissiaTitle({ ...context, season: 2 }, season2)).toBe(context.nativeTitle);
    expect(matchAnissiaTitle(context, season2)).toBeUndefined();
    expect(matchAnissiaTitle({ ...context, season: 1 }, season2)).toBeUndefined();
    expect(
      matchAnissiaTitle(
        { ...context, title: 'Test Show Season 2', nativeTitle: undefined },
        { ...anime, subject: 'Test Show 2기' },
      ),
    ).toBe('Test Show Season 2');
  });
});

describe('automatic Anissia provider', () => {
  it('merges all nine weeks, deduplicates animeNo, retains every ready decimal-episode author and caches across instances', async () => {
    let now = 1000;
    const cache = new Database();
    await cache.clear();
    const fetchMock = vi.fn(async (url: string) =>
      url.includes('/schedule/')
        ? json({ code: 'ok', data: [anime] })
        : json({
            code: 'ok',
            data: [
              caption,
              { ...caption, name: '제작자 B', website: 'http://blog.example/other' },
              { ...caption, website: '  ' },
              { ...caption, episode: '12' },
            ],
          }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const provider = () => new AnissiaProvider(undefined, undefined, cache, () => now);
    const results = await provider().search(context, 'ko');
    expect(results).toHaveLength(3);
    expect(results[2]).toMatchObject({
      listedEpisode: '12',
      episode: '12.5',
      requireEpisodeMatch: true,
    });
    expect(results[0]).toMatchObject({
      provider: 'anissia',
      episode: '012.50',
      author: caption.name,
      pageUrl: caption.website,
      updatedAt: caption.updDt,
      ...anime,
    });
    expect(
      fetchMock.mock.calls
        .filter(([url]) => url.includes('/schedule/'))
        .map(([url]) => url.split('/').at(-1))
        .sort(),
    ).toEqual(['0', '1', '2', '3', '4', '5', '6', '7', '8']);
    expect(fetchMock.mock.calls.filter(([url]) => url.includes('/caption/'))).toHaveLength(1);
    await provider().search(context, 'ko');
    expect(fetchMock.mock.calls.filter(([url]) => url.includes('/schedule/'))).toHaveLength(9);
    now += ANISSIA_SCHEDULE_TTL;
    await provider().search(context, 'ko');
    expect(fetchMock.mock.calls.filter(([url]) => url.includes('/schedule/'))).toHaveLength(18);
    expect(fetchMock.mock.calls.filter(([url]) => url.includes('/caption/'))).toHaveLength(3);
  });
  it('does not query the API for Japanese and is enabled without user keys', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const providers = createProviders(defaultSettings);
    expect(providers.map((p) => p.id)).toEqual(['anissia', 'jimaku', 'kitsunekko']);
    expect(await providers[0].search(context, 'ja')).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('accepts documented bare arrays and refuses an API error envelope', async () => {
    const cache = new Database();
    await cache.clear();
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => (url.includes('/schedule/') ? json([anime]) : json([caption]))),
    );
    expect(
      await new AnissiaProvider(undefined, undefined, cache).search(context, 'ko'),
    ).toHaveLength(1);
    await cache.clear();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json({ code: 'error', data: [] })),
    );
    await expect(
      new AnissiaProvider(undefined, undefined, cache).search(context, 'ko'),
    ).rejects.toThrow('편성표');
  });
  it('does not persist partial schedule outages and recovers failed weeks next time', async () => {
    const cache = new Database();
    await cache.clear();
    const mock = vi.fn(async (url: string) =>
      url.endsWith('/schedule/8')
        ? Promise.reject(Error('offline'))
        : json({ code: 'ok', data: url.includes('/schedule/') ? [anime] : [caption] }),
    );
    vi.stubGlobal('fetch', mock);
    expect(
      await new AnissiaProvider(undefined, undefined, cache).search(context, 'ko'),
    ).toHaveLength(1);
    expect(await cache.get('anissia:schedule:v1')).toBeUndefined();
    await new AnissiaProvider(undefined, undefined, cache).search(context, 'ko');
    expect(mock.mock.calls.filter(([url]) => url.includes('/schedule/'))).toHaveLength(18);
  });
  it('does not parse a distribution page as a subtitle file', async () => {
    const resolver = new SubtitleLinkResolverChain([], vi.fn());
    vi.spyOn(resolver, 'resolve').mockResolvedValue({
      kind: 'page',
      pageUrl: caption.website,
      message: '배포 페이지에서 확인하세요.',
    });
    const provider = new AnissiaProvider(undefined, resolver);
    await expect(
      provider.download({
        id: 'test',
        providerId: 'anissia',
        title: '',
        release: '',
        language: 'ko',
        pageUrl: caption.website,
      }),
    ).rejects.toBeInstanceOf(SubtitleLinkUnavailable);
  });
});
