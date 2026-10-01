import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { filenameEpisode, japaneseFileCandidate } from '../src/providers/japanese/fileMatching';
import { JimakuProvider } from '../src/providers/jimaku/JimakuProvider';
import { KitsunekkoProvider, parseCatalog } from '../src/providers/kitsunekko/KitsunekkoProvider';
import { database } from '../src/storage/database';
const c = {
  site: 'reanime' as const,
  title: 'Frieren',
  nativeTitle: '葬送のフリーレン',
  romajiTitle: 'Sousou no Frieren',
  englishTitle: 'Frieren: Beyond Journey’s End',
  episode: 7,
  anilistId: 154587,
  pageUrl: 'https://reanime.to/watch/frieren?ep=7',
};
const json = (v: unknown) => new Response(JSON.stringify(v));
const entry = {
  id: 100,
  anilist_id: 154587,
  name: 'Sousou no Frieren',
  japanese_name: '葬送のフリーレン',
};
const catalog =
  '<table><tr><td>1</td><td><a href="anime_tv/sousou-no-frieren.html">Sousou no Frieren</a></td><td>Anime TV</td><td>Frieren: Beyond Journey’s End</td><td>葬送のフリーレン</td></tr></table>';
afterEach(() => vi.unstubAllGlobals());
beforeEach(async () => {
  await database.clear();
});
describe('conservative episode and release matching', () => {
  it.each([
    '01',
    '1',
    'E01',
    'EP01',
    'Episode 01',
    'S01E01',
    '[SubsPlease] Show - 01 (1080p) [C8FFA121] ja',
    'Show_01',
  ])('supports %s', (name) => {
    expect(filenameEpisode(name + '.ass')?.episode).toBe('1');
  });
  it('preserves decimals, distinguishes specials, rejects batch ranges and ambiguous title numbers', () => {
    expect(filenameEpisode('Show - 12.5.srt')?.episode).toBe('12.5');
    for (const special of ['OVA', 'SP', 'Special'])
      expect(filenameEpisode('Show ' + special + '.ass')?.special).toBe(special.toLowerCase());
    for (const name of [
      'Show 01-12.ass',
      'Show batch.ass',
      'Show 1080p.ass',
      '86 01.ass',
      'Show.ass',
    ])
      expect(filenameEpisode(name)).toBeUndefined();
    const make = (name: string, context: import('../src/anime/AnimeContext').AnimeContext = c) =>
      japaneseFileCandidate(
        context,
        'jimaku',
        { title: entry.name, matchedTitle: c.title },
        { name, url: 'https://jimaku.cc/file/' + name },
      );
    expect(make('Show EP08.ass')).toBeUndefined();
    expect(make('Show S02E07.ass')).toBeUndefined();
    expect(make('Show SP07.ass')).toBeUndefined();
    expect(make('Show E07.en.srt')).toBeUndefined();
    expect(make('Show E07 2020.ass', { ...c, year: 2026 })).toBeUndefined();
    expect(make('Show E07.ass')).toBeDefined();
  });
});
describe('documented Japanese providers', () => {
  it('Jimaku prioritizes AniList ID, uses raw Authorization, and verifies every filename itself', async () => {
    const fetch = vi.fn(async (url: string) =>
      url.includes('/search?')
        ? json([entry])
        : json([
            {
              name: 'Show E07.ass',
              url: 'https://jimaku.cc/file/7.ass',
              size: 100,
              last_modified: '2026-10-01',
            },
            { name: 'Show E08.ass', url: 'https://jimaku.cc/file/8.ass', size: 100 },
          ]),
    );
    vi.stubGlobal('fetch', fetch);
    const found = await new JimakuProvider('test-key').search(c, 'ja');
    expect(found).toHaveLength(1);
    expect(found[0].anilistId).toBe(154587);
    expect(fetch.mock.calls[0][0]).toContain('entries/search?anilist_id=154587');
    expect(fetch.mock.calls[1][0]).toBe('https://jimaku.cc/api/entries/100/files');
    expect((fetch.mock.calls as unknown as [string, RequestInit][])[0][1].headers).toEqual({
      Authorization: 'test-key',
    });
  });
  it('Jimaku title fallback refuses fuzzy matches and conflicting AniList entries', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json([{ ...entry, name: 'Wrong Show', japanese_name: '' }])),
    );
    expect(
      await new JimakuProvider('test').search(
        { ...c, anilistId: undefined, nativeTitle: undefined, romajiTitle: undefined },
        'ja',
      ),
    ).toEqual([]);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json([{ ...entry, anilist_id: 999 }])),
    );
    expect(await new JimakuProvider('test').search(c, 'ja')).toEqual([]);
  });
  it('Kitsunekko parses HTML aliases, uses real mirror file links and caches the catalog across instances', async () => {
    expect(parseCatalog(catalog)[0]).toMatchObject({
      japanese: '葬送のフリーレン',
      url: 'https://subtitles.ajatt.top/anime_tv/sousou-no-frieren.html',
    });
    const root =
      'https://raw.githubusercontent.com/Ajatt-Tools/kitsunekko-mirror/refs/heads/main/subtitles/anime_tv/Sousou%20no%20Frieren/';
    const fetch = vi.fn(
      async (url: string) =>
        new Response(
          url === 'https://subtitles.ajatt.top/'
            ? catalog
            : `<a href="${root}Show%20-%2007.ass">07</a><a href="${root}Show%20-%2008.ass">08</a><a href="https://evil.example/Show%20-%2007.ass">x</a>`,
        ),
    );
    vi.stubGlobal('fetch', fetch);
    expect(await new KitsunekkoProvider().search(c, 'ja')).toHaveLength(1);
    expect(await new KitsunekkoProvider().search(c, 'ja')).toHaveLength(1);
    expect(fetch.mock.calls.filter(([url]) => url === 'https://subtitles.ajatt.top/')).toHaveLength(
      1,
    );
  });
  it('Kitsunekko does not select a wrong season or unknown episode', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async (url: string) =>
          new Response(
            url === 'https://subtitles.ajatt.top/'
              ? catalog
              : '<a href="https://raw.githubusercontent.com/Ajatt-Tools/kitsunekko-mirror/main/Show.ass">x</a>',
          ),
      ),
    );
    expect(await new KitsunekkoProvider().search(c, 'ja')).toEqual([]);
    expect(await new KitsunekkoProvider().search({ ...c, season: 2 }, 'ja')).toEqual([]);
  });
});
