// Canonical decimal strings retain precision and never merge specials/ranges with an episode.
export function normalizeEpisode(value: string | number | undefined): string | undefined {
  if (typeof value !== 'string' && typeof value !== 'number') return undefined;
  if (typeof value === 'number' && (!Number.isFinite(value) || value < 0)) return undefined;
  const text = String(value).normalize('NFKC').trim();
  const match = text.match(
    /^(?:(?:episode|ep|e|第|제)\s*)?(\d+(?:\.\d+)?|\.\d+)\s*(?:話|화|회)?$/i,
  );
  if (!match) return undefined;
  const [whole, fraction = ''] = match[1].split('.');
  const integer = (whole || '0').replace(/^0+(?=\d)/, '');
  const decimal = fraction.replace(/0+$/, '');
  return integer + (decimal ? '.' + decimal : '');
}
export function episodeFromSubtitleName(value: string): string | undefined {
  return filenameEpisode(value)?.episode;
}

export function filenameEpisode(
  value: string,
): { episode: string; season?: number; special?: string } | undefined {
  const name = value.normalize('NFKC').replace(/\.(smi|srt|ass|ssa|vtt|zip)$/i, '');
  if (/\d\s*[-~]\s*\d/.test(name) || /\b(?:batch|complete)\b/i.test(name)) return undefined;
  const special = name.match(/\b(ova|sp|special)[\s._-]*(\d+(?:\.\d+)?)?\b/i);
  if (special)
    return { episode: normalizeEpisode(special[2] ?? '1')!, special: special[1].toLowerCase() };
  const se = name.match(/\bs(\d{1,2})e(\d+(?:\.\d+)?)(?=$|[\s._\]\-])/i);
  if (se) return { season: Number(se[1]), episode: normalizeEpisode(se[2])! };
  const explicit =
    name.match(/\b(?:episode|ep|e)[\s._-]*(\d+(?:\.\d+)?)(?=$|[\s._\]\-])/i) ??
    name.match(/第\s*(\d+(?:\.\d+)?)\s*話/);
  if (explicit) return { episode: normalizeEpisode(explicit[1])! };
  // A release separator has more confidence than a number embedded in the title.
  const release = [...name.matchAll(/\s-\s*(\d+(?:\.\d+)?)(?=$|[\s_\]\-])/g)];
  if (release.length === 1) return { episode: normalizeEpisode(release[0][1])! };
  const clean = name
    .replace(/\[[^\]]*\]|\([^)]*\)/g, ' ')
    .replace(/\b(?:season\s*\d+|\d+(?:st|nd|rd|th)\s*season|part\s*\d+|cour\s*\d+|s\d+)\b/gi, ' ');
  const numbers = [...clean.matchAll(/(?:^|[\s._-])(\d+(?:\.\d+)?)(?=$|[\s._-])/g)]
    .map((m) => normalizeEpisode(m[1])!)
    .filter((n) => Number(n) < 1900); // years, resolution and CRC must not become episodes
  return numbers.length === 1 ? { episode: numbers[0] } : undefined;
}
