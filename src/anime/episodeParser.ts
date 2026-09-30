export function positiveNumber(value: unknown): number | undefined {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}
export function parseEpisode(value: string): number | undefined {
  const m = value.match(/(?:episode|ep|e)[\s._-]*(\d+(?:\.\d+)?)/i);
  return m ? positiveNumber(m[1]) : undefined;
}
export function parseSeason(title: string): number | undefined {
  const m = title.match(/(?:season\s*(\d+)|(\d+)(?:st|nd|rd|th)\s*season|\bS(\d{1,2})\b)/i);
  return m ? positiveNumber(m[1] ?? m[2] ?? m[3]) : undefined;
}
