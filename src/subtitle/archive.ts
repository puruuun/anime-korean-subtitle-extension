import { unzipSync } from 'fflate';
import { filenameEpisode, normalizeEpisode } from '../anime/episodeNormalizer';
import { AppError } from '../utils/errors';
export function extractSubtitle(
  buffer: ArrayBuffer,
  episode: number,
  episodeType?: string,
  season = 1,
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
  const names = Object.keys(files);
  const matching = names.filter((n) => {
    const parsed = filenameEpisode(n.split('/').at(-1)!);
    return (
      !!parsed &&
      parsed.episode === normalizeEpisode(episode) &&
      parsed.special === episodeType &&
      (parsed.season === undefined || parsed.season === season)
    );
  });
  const chosen = matching.length === 1 ? matching[0] : names.length === 1 ? names[0] : undefined;
  if (!chosen)
    throw new AppError(
      'ARCHIVE',
      '압축 파일의 회차를 확정할 수 없습니다. 회차별 자막 후보를 선택하세요.',
    );
  const parsed = filenameEpisode(chosen.split('/').at(-1)!);
  if (
    parsed &&
    (parsed.episode !== normalizeEpisode(episode) ||
      parsed.special !== episodeType ||
      (parsed.season !== undefined && parsed.season !== season))
  )
    throw new AppError('EPISODE', '압축 파일 안 자막의 회차가 다릅니다.');
  return { bytes: files[chosen], name: chosen };
}
