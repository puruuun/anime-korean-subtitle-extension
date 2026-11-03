import { unzipSync } from 'fflate';
import { filenameEpisode, normalizeEpisode } from '../anime/episodeNormalizer';
import { AppError } from '../utils/errors';
import { zipNames } from './zipNames';

const BONUS_PATTERN = /\b(?:ncop|nced|op|ed|pv|cm|menu|preview|credit|특전|예고|오프닝|엔딩)\b/i;
const WEB_BD_PATTERN =
  /(?:^|[\s._([\/\-])(?:webrip|web-dl|webdl|bd|bdrip|bluray|blu-ray|netflix|nf|dmmtv|amzn|crunchyroll|retimed)(?:$|[\s._)\/\-])/i;
const TV_CAPTURE_PATTERN =
  /(?:^|[\s._([\/\-])(?:at-x|cbc|tbs|bs11|bsn|tokyo\s*mx|mbs|tv\s*tokyo|sun\s*tv|kbs|shincaps|nanakoraws|mpeg2)(?:$|[\s._)\/\-])/i;

export function rankArchiveEntry(name: string, language: 'ko' | 'ja' = 'ko'): number {
  let score = 0;
  if (WEB_BD_PATTERN.test(name)) score += 40;
  if (!/(?:^|[\s._([\/\-])retimed(?:$|[\s._)\/\-])/i.test(name) && TV_CAPTURE_PATTERN.test(name)) {
    score -= 25;
  }
  const ext = name.split('.').at(-1)?.toLowerCase() ?? '';
  if (language === 'ko') {
    if (ext === 'smi') score += 6;
    else if (ext === 'srt') score += 5;
    else if (ext === 'ass') score += 4;
    else if (ext === 'ssa') score += 3;
    else if (ext === 'vtt') score += 2;
  } else {
    if (ext === 'srt') score += 6;
    else if (ext === 'ass') score += 5;
    else if (ext === 'ssa') score += 4;
    else if (ext === 'vtt') score += 3;
    else if (ext === 'smi') score += 2;
  }
  return score;
}

export function extractSubtitle(
  buffer: ArrayBuffer,
  episode: number,
  episodeType?: string,
  season = 1,
  alternateEpisodes: string[] = [],
  requireEpisodeMatch = false,
  language: 'ko' | 'ja' = 'ko',
): { bytes: Uint8Array; name: string } {
  const bytes = new Uint8Array(buffer);
  if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) return { bytes, name: 'subtitle' };
  let total = 0;
  const files = unzipSync(bytes, {
    filter: (f) => {
      if (!/\.(smi|srt|vtt|ass|ssa)$/i.test(f.name)) return false;
      total += f.originalSize;
      if (total > 24 * 1024 * 1024 || f.originalSize > 8 * 1024 * 1024)
        throw new AppError('SIZE', '압축 자막의 크기가 너무 큽니다.');
      return true;
    },
  });
  const decoded = zipNames(bytes, language);
  const entries = Object.keys(files).map((key) => ({ key, name: decoded.get(key) ?? key }));
  const names = entries.map((entry) => entry.name);
  const matching = names.filter((n) => {
    const parsed = filenameEpisode(n.split('/').at(-1)!, season);
    return (
      !!parsed &&
      [normalizeEpisode(episode), ...alternateEpisodes].includes(parsed.episode) &&
      parsed.special === episodeType &&
      (parsed.season === undefined || parsed.season === season)
    );
  });

  let candidateMatching = matching;
  if (candidateMatching.length > 1) {
    const nonBonus = candidateMatching.filter((n) => !BONUS_PATTERN.test(n.split('/').at(-1)!));
    if (nonBonus.length > 0) {
      candidateMatching = nonBonus;
    }
  }

  let chosen: string | undefined;
  const distinctEpisodes = new Set(
    candidateMatching
      .map((n) => filenameEpisode(n.split('/').at(-1)!, season)?.episode)
      .filter(Boolean),
  );
  if (distinctEpisodes.size === 1) {
    const sorted = [...candidateMatching].sort(
      (a, b) => rankArchiveEntry(b, language) - rankArchiveEntry(a, language) || a.localeCompare(b),
    );
    chosen = sorted[0];
  } else if (names.length === 1 && !requireEpisodeMatch) {
    chosen = names[0];
  }

  if (!chosen)
    throw new AppError(
      'ARCHIVE',
      '압축 파일의 회차를 확정할 수 없습니다. 회차별 자막 후보를 선택하세요.',
    );
  const parsed = filenameEpisode(chosen.split('/').at(-1)!, season);
  if (
    parsed &&
    (![normalizeEpisode(episode), ...alternateEpisodes].includes(parsed.episode) ||
      parsed.special !== episodeType ||
      (parsed.season !== undefined && parsed.season !== season))
  )
    throw new AppError('EPISODE', '압축 파일 안 자막의 회차가 다릅니다.');
  return { bytes: files[entries.find((entry) => entry.name === chosen)!.key], name: chosen };
}
