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
  seasonHint?: number,
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
    name.match(/第\s*(\d+(?:\.\d+)?)\s*話/) ??
    name.match(/(?:^|[\s._-])(\d+(?:\.\d+)?)\s*(?:화|회|話)(?=$|[\s._\]\-(])/i) ??
    name.match(/\bLv[\s._-]*(\d+(?:\.\d+)?)(?:\s+(?:미완성|완성|END|完|끝))?$/i);
  if (explicit) return { episode: normalizeEpisode(explicit[1])! };
  // A release separator has more confidence than a number embedded in the title.
  const release = [...name.matchAll(/\s-\s*(\d+(?:\.\d+)?)(?=$|[\s_\]\-])/g)];
  if (release.length === 1) return { episode: normalizeEpisode(release[0][1])! };
  const clean = name
    .replace(/\[[^\]]*\]|\([^)]*\)/g, ' ')
    .replace(/\b(?:season\s*\d+|\d+(?:st|nd|rd|th)\s*season|part\s*\d+|cour\s*\d+|s\d+)\b/gi, ' ');
  const numbers = [...clean.matchAll(/(?:^|[\s_-]|(?<!\d)\.)(\d+(?:\.\d+)?)(?=$|[\s._-])/g)]
    .map((m) => normalizeEpisode(m[1])!)
    .filter((n) => Number(n) < 1900); // years, resolution and CRC must not become episodes
  if (numbers.length === 1) return { episode: numbers[0] };
  // Anissia's verified second-season archives sometimes name files "Title 2 01.ass".
  if (numbers.length === 2 && seasonHint && seasonHint > 1 && numbers[0] === String(seasonHint))
    return { season: seasonHint, episode: numbers[1] };
  // Only fall back to attached/stripped trailing numbers when no standalone numbers were already ambiguous.
  if (numbers.length > 0) return undefined;
  const trailingClean = clean
    .replace(
      /\b(?:1080p|720p|480p|2160p|4k|x264|x265|h\.?264|h\.?265|hevc|av1|10bit|8bit|aac\d*(?:\.\d+)?|ddp\d*(?:\.\d+)?|ac3|mp4|mkv|webm|v\d+|web-?dl|webrip|bluray|bdrip|remux)\b/gi,
      ' ',
    )
    .replace(/(?:제\s*)?\d+\s*기/g, ' ')
    .replace(/\s*(?:자막|완결|수정본?|최종|v\d+)\s*$/gi, '')
    .trim();
  const cjkAttached = [
    ...trailingClean.matchAll(
      /[\p{Script=Hangul}\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}](\d{1,3}(?:\.\d+)?)(?=$|[\s._-])/gu,
    ),
  ]
    .map((m) => normalizeEpisode(m[1])!)
    .filter((n) => Number(n) < 1900);
  if (cjkAttached.length === 1) return { episode: cjkAttached[0] };
  const trailingNumbers = [
    ...trailingClean.matchAll(/(?:^|[\s_-]|(?<!\d)\.)(\d+(?:\.\d+)?)(?=$|[\s._-])/g),
  ]
    .map((m) => normalizeEpisode(m[1])!)
    .filter((n) => Number(n) < 1900);
  if (trailingNumbers.length === 1) return { episode: trailingNumbers[0] };
  const latinAttached = trailingClean.match(/(?:^|[\s._-])[A-Za-z]{3,}(\d{1,3}(?:\.\d+)?)$/);
  if (latinAttached) {
    const ep = normalizeEpisode(latinAttached[1])!;
    if (Number(ep) < 1900) return { episode: ep };
  }
  return undefined;
}
