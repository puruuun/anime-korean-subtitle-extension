import type { AnimeContext } from '../../anime/AnimeContext';
import { matchedTitle } from '../../anime/titleNormalizer';
export interface AnissiaAnime {
  animeNo: number;
  subject: string;
  originalSubject: string;
  startDate: string;
  endDate: string;
}
export function matchAnissiaTitle(c: AnimeContext, anime: AnissiaAnime): string | undefined {
  const startYear = /^\d{4}-/.test(anime.startDate)
    ? Number(anime.startDate.slice(0, 4))
    : undefined;
  const endYear = /^\d{4}-/.test(anime.endDate) ? Number(anime.endDate.slice(0, 4)) : undefined;
  if (
    c.year &&
    ((startYear !== undefined && c.year < startYear) || (endYear !== undefined && c.year > endYear))
  )
    return undefined;
  return matchedTitle(c, [anime.subject, anime.originalSubject]);
}
