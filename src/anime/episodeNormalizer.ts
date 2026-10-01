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
  const name = value.normalize('NFKC').replace(/\.(?:smi|srt|ass|ssa|vtt|zip)$/i, '');
  const explicit = name.match(
    /\b(?:s\d{1,2})?e(?:p(?:isode)?)?[\s._-]*(\d+(?:\.\d+)?)(?=$|[\s._\]\-])/i,
  )?.[1];
  const bare = name.match(/(?:^|[\s._\[\]-])(\d+(?:\.\d+)?)(?=$|[\s._\]\-])/i)?.[1];
  return normalizeEpisode(explicit ?? bare);
}
