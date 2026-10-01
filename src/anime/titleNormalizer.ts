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
        c.englishTitle,
        c.romajiTitle,
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
