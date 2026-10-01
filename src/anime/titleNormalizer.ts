import type { AnimeContext } from './AnimeContext';
export function normalizeTitle(title: string): string {
  return title
    .normalize('NFKC')
    .toLowerCase()
    .replace(
      /\b(?:season\s*\d+|\d+(?:st|nd|rd|th)\s*season|part\s*\d+|cour\s*\d+|s\d{1,2}|ep(?:isode)?\s*\d+(?:\.\d+)?)\b/gi,
      ' ',
    )
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}
export function titleCandidates(c: AnimeContext): string[] {
  return [
    ...new Set(
      [
        c.nativeTitle,
        c.romajiTitle,
        c.englishTitle,
        c.koreanTitle,
        ...(c.synonyms ?? []),
        c.titles?.japanese,
        c.titles?.english,
        c.titles?.romaji,
        ...(c.titles?.synonyms ?? []),
        c.titles?.korean,
        c.title,
      ].filter((v): v is string => !!v?.trim()),
    ),
  ];
}

export function titleSignature(value: string) {
  let season: number | undefined, part: number | undefined, cour: number | undefined;
  const text = value
    .normalize('NFKC')
    .toLowerCase()
    .replace(
      /(?:\bseason\s*(\d+)|\b(\d+)(?:st|nd|rd|th)\s*season\b|\bs(\d{1,2})\b|第\s*(\d+)\s*期|(\d+)\s*기)/gi,
      (_all, ...groups: (string | number | undefined)[]) => {
        season = Number(groups.slice(0, 5).find((v) => v !== undefined));
        return ' ';
      },
    )
    .replace(/\b(part|cour)\s*(\d+)\b/gi, (_all, kind: string, n: string) => {
      if (kind.toLowerCase() === 'part') part = Number(n);
      else cour = Number(n);
      return ' ';
    });
  return { key: text.replace(/[^\p{L}\p{N}]/gu, ''), season, part, cour };
}
export function matchedTitle(c: AnimeContext, aliases: string[]): string | undefined {
  for (const title of titleCandidates(c)) {
    const a = titleSignature(title);
    if (!a.key) continue;
    for (const alias of aliases) {
      const b = titleSignature(alias);
      if (
        a.key === b.key &&
        (c.season ?? a.season ?? 1) === (b.season ?? 1) &&
        (a.part ?? 1) === (b.part ?? 1) &&
        (a.cour ?? 1) === (b.cour ?? 1)
      )
        return title;
    }
  }
  return undefined;
}
