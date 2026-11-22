export interface AnimeContext {
  site: 'miruro' | 'reanime' | 'generic';
  /** Stable site catalogue ID, unaffected by late AniList metadata enrichment. */
  animeId?: string;
  title: string;
  englishTitle?: string;
  romajiTitle?: string;
  nativeTitle?: string;
  koreanTitle?: string;
  episodeType?: 'ova' | 'sp' | 'special';
  synonyms?: string[];
  titles?: {
    english?: string;
    romaji?: string;
    japanese?: string;
    korean?: string;
    synonyms?: string[];
  };
  episode: number;
  /** Verified episode count of preceding TV seasons, for cumulative release filenames. */
  episodeOffset?: number;
  season?: number;
  year?: number;
  anilistId?: number;
  malId?: number;
  imdbId?: string;
  tmdbId?: number;
  pageUrl: string;
}
export function siteAnimeId(url: string): string | undefined {
  try {
    return new URL(url).pathname.match(/^\/watch\/([^/]+)/)?.[1];
  } catch {
    return undefined;
  }
}
const TRANSIENT_QUERY_PARAMS = new Set([
  't',
  'time_continue',
  'start',
  'end',
  'si',
  'pp',
  'feature',
  'ref',
  'fbclid',
  'gclid',
]);
export function stableOriginPath(url: string): string | undefined {
  try {
    const u = new URL(url);
    if (!['http:', 'https:'].includes(u.protocol)) return undefined;
    const pathname = u.pathname.length > 1 ? u.pathname.replace(/\/+$/, '') : u.pathname;
    const kept = [...u.searchParams.entries()]
      .filter(([key]) => {
        const lower = key.toLowerCase();
        return !TRANSIENT_QUERY_PARAMS.has(lower) && !lower.startsWith('utm_');
      })
      .sort(([aKey, aVal], [bKey, bVal]) => aKey.localeCompare(bKey) || aVal.localeCompare(bVal));
    const filteredSearch = new URLSearchParams(kept).toString();
    return u.origin.toLowerCase() + pathname + (filteredSearch ? '?' + filteredSearch : '');
  } catch {
    return undefined;
  }
}
function genericEpisodeId(c: AnimeContext): string {
  return c.animeId ?? stableOriginPath(c.pageUrl) ?? c.title.normalize('NFKC').toLowerCase();
}
export function episodeKey(c: AnimeContext): string {
  const id =
    c.site === 'generic'
      ? genericEpisodeId(c)
      : (c.animeId ??
        siteAnimeId(c.pageUrl) ??
        (c.anilistId
          ? 'anilist-' + c.anilistId
          : c.malId
            ? 'mal-' + c.malId
            : c.title.normalize('NFKC').toLowerCase()));
  return [c.site, id, c.season ?? 1, c.episode, c.episodeType ?? 'tv'].join(':');
}
export function contextKey(c: AnimeContext) {
  return JSON.stringify([
    c.site,
    c.site === 'generic'
      ? genericEpisodeId(c)
      : c.anilistId
        ? 'anilist:' + c.anilistId
        : c.malId
          ? 'mal:' + c.malId
          : c.title.normalize('NFKC').toLowerCase(),
    c.season ?? null,
    c.episode,
  ]);
}
