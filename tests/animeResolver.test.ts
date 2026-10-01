import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveAnime } from '../src/anime/AnimeResolver';
const c = {
  site: 'miruro' as const,
  title: 'You and I Are Polar Opposites Season 2',
  season: 2,
  episode: 12,
  pageUrl: 'https://www.miruro.to/',
};
const title = {
  english: c.title,
  romaji: 'Seihantai na Kimi to Boku 2nd Season',
  native: '正反対な君と僕 第2期',
};
const prequel = {
  id: 184951,
  type: 'ANIME',
  format: 'TV',
  episodes: 12,
  title: { english: 'You and I Are Polar Opposites', native: '正反対な君と僕' },
};
const m = {
  id: 210031,
  idMal: 63832,
  title,
  synonyms: [],
  startDate: { year: 2026 },
  relations: { edges: [{ relationType: 'PREQUEL', node: prequel }] },
};
afterEach(() => vi.unstubAllGlobals());
describe('AniList title enrichment regression', () => {
  it.each([{ ...c }, { ...c, anilistId: m.id }, { ...c, malId: m.idMal }])(
    'declares only the variable used by the GraphQL filter and preserves the exact season',
    async (context) => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async (_url, init) => {
          const body = JSON.parse(init.body);
          expect(body.query).toMatch(/^query\(\$value:(?:Int|String)\)/);
          expect(body.query.match(/\$value/g)).toHaveLength(2);
          expect(Object.keys(body.variables)).toEqual(['value']);
          return new Response(JSON.stringify({ data: { Media: m } }));
        }),
      );
      expect(await resolveAnime(context)).toMatchObject({
        anilistId: m.id,
        titles: { japanese: title.native },
        episodeOffset: 12,
      });
    },
  );
  it('does not accept season one as an exact season two search result', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({ data: { Media: { ...m, title: prequel.title, id: prequel.id } } }),
          ),
      ),
    );
    expect(await resolveAnime(c)).toEqual(c);
  });
  it.each([
    { ...prequel, format: 'MOVIE' },
    { ...prequel, episodes: null },
    { ...prequel, title: { english: 'Unrelated Show' } },
  ])('does not infer a cumulative offset from an unverified prequel', async (node) => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              data: { Media: { ...m, relations: { edges: [{ relationType: 'PREQUEL', node }] } } },
            }),
          ),
      ),
    );
    const result = await resolveAnime(c);
    expect(result.anilistId).toBe(m.id);
    expect(result.episodeOffset).toBeUndefined();
  });
});
