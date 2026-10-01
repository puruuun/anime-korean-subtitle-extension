import type { AnimeContext } from '../../anime/AnimeContext';
import { titleCandidates } from '../../anime/titleNormalizer';
export interface AnissiaAnime {
  animeNo: number;
  subject: string;
  originalSubject: string;
  startDate: string;
  endDate: string;
}
function signature(value: string) {
  let season: number | undefined;
  const text = value
    .normalize('NFKC')
    .toLowerCase()
    .replace(
      /(?:\bseason\s*(\d+)|\b(\d+)(?:st|nd|rd|th)\s*season\b|\bs(\d{1,2})\b|第\s*(\d+)\s*期|(\d+)\s*기)/gi,
      (_all, ...groups: (string | number | undefined)[]) => {
        season = Number(groups.slice(0, 5).find((v) => v !== undefined));
        return ' ';
      },
    );
  return { key: text.replace(/[^\p{L}\p{N}]/gu, ''), season };
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
  for (const title of titleCandidates(c)) {
    const a = signature(title);
    if (!a.key) continue;
    for (const source of [anime.subject, anime.originalSubject]) {
      const b = signature(source);
      if (a.key === b.key && (c.season ?? a.season ?? 1) === (b.season ?? 1)) return title;
    }
  }
  return undefined;
}
