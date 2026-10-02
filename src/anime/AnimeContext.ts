export interface AnimeContext {
  site: 'miruro' | 'reanime';
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
export function episodeKey(c: AnimeContext): string {
  const id =
    c.animeId ??
    siteAnimeId(c.pageUrl) ??
    (c.anilistId
      ? 'anilist-' + c.anilistId
      : c.malId
        ? 'mal-' + c.malId
        : c.title.normalize('NFKC').toLowerCase());
  return [c.site, id, c.season ?? 1, c.episode, c.episodeType ?? 'tv'].join(':');
}
export function contextKey(c: AnimeContext) {
  return JSON.stringify([
    c.site,
    c.anilistId
      ? 'anilist:' + c.anilistId
      : c.malId
        ? 'mal:' + c.malId
        : c.title.normalize('NFKC').toLowerCase(),
    c.season ?? null,
    c.episode,
  ]);
}
