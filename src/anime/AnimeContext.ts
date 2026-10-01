export interface AnimeContext {
  site: 'miruro' | 'reanime';
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
  season?: number;
  year?: number;
  anilistId?: number;
  malId?: number;
  imdbId?: string;
  tmdbId?: number;
  pageUrl: string;
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
