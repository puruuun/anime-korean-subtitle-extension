import { unzipSync } from 'fflate';
import { parseEpisode } from '../anime/episodeParser';
import { AppError } from '../utils/errors';
export function extractSubtitle(
  buffer: ArrayBuffer,
  episode: number,
): { bytes: Uint8Array; name: string } {
  const bytes = new Uint8Array(buffer);
  if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) return { bytes, name: 'subtitle' };
  let total = 0;
  const files = unzipSync(bytes, {
    filter: (f) => {
      if (!/\.(srt|vtt|ass|ssa)$/i.test(f.name)) return false;
      total += f.originalSize;
      if (total > 24 * 1024 * 1024 || f.originalSize > 8 * 1024 * 1024)
        throw new AppError('SIZE', '압축 자막의 크기가 너무 큽니다.');
      return true;
    },
  });
  const names = Object.keys(files);
  const matching = names.filter(
    (n) =>
      parseEpisode(n) === episode ||
      Number(n.match(/(?:^|[\s._\[\]-])(\d{1,3})(?:[\s._\]\-]|\.(?:srt|vtt|ass)$)/i)?.[1]) ===
        episode,
  );
  const chosen = matching.length === 1 ? matching[0] : names.length === 1 ? names[0] : undefined;
  if (!chosen)
    throw new AppError(
      'ARCHIVE',
      '압축 파일의 회차를 확정할 수 없습니다. 회차별 자막 후보를 선택하세요.',
    );
  const ep = parseEpisode(chosen);
  if (ep !== undefined && ep !== episode)
    throw new AppError('EPISODE', '압축 파일 안 자막의 회차가 다릅니다.');
  return { bytes: files[chosen], name: chosen };
}
