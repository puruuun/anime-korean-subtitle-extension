import { AppError } from '../utils/errors';
function crc32(bytes: Uint8Array) {
  let crc = -1;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ -1) >>> 0;
}
/** Read Unicode Path extra fields before falling back to Korean/Japanese legacy names. */
export function zipNames(bytes: Uint8Array, language: 'ko' | 'ja'): Map<string, string> {
  const names = new Map<string, string>(),
    view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = bytes.length - 22;
  for (; end >= Math.max(0, bytes.length - 65557); end--)
    if (view.getUint32(end, true) === 0x06054b50) break;
  if (end < 0 || view.getUint32(end, true) !== 0x06054b50) return names;
  let at = view.getUint32(end + 16, true);
  const count = view.getUint16(end + 10, true);
  for (let i = 0; i < count; i++) {
    if (at + 46 > bytes.length || view.getUint32(at, true) !== 0x02014b50)
      throw new AppError('ARCHIVE', 'ZIP 파일 이름 정보를 읽지 못했습니다.');
    const flags = view.getUint16(at + 8, true),
      length = view.getUint16(at + 28, true),
      extraLength = view.getUint16(at + 30, true),
      commentLength = view.getUint16(at + 32, true);
    const nameStart = at + 46,
      extraStart = nameStart + length,
      next = extraStart + extraLength + commentLength;
    if (next > bytes.length) throw new AppError('ARCHIVE', 'ZIP 파일 이름 정보가 잘못되었습니다.');
    const raw = bytes.slice(nameStart, extraStart);
    const original =
      flags & 0x800
        ? new TextDecoder().decode(raw)
        : Array.from(raw, (b) => String.fromCharCode(b)).join('');
    let decoded: string | undefined;
    for (let p = extraStart; p + 4 <= extraStart + extraLength; ) {
      const type = view.getUint16(p, true),
        size = view.getUint16(p + 2, true);
      p += 4;
      if (p + size > extraStart + extraLength) break;
      if (
        type === 0x7075 &&
        size >= 5 &&
        bytes[p] === 1 &&
        view.getUint32(p + 1, true) === crc32(raw)
      ) {
        try {
          decoded = new TextDecoder('utf-8', { fatal: true }).decode(bytes.slice(p + 5, p + size));
        } catch {
          /* use legacy name below */
        }
      }
      p += size;
    }
    if (!decoded && !(flags & 0x800) && raw.some((b) => b > 127)) {
      try {
        decoded = new TextDecoder(language === 'ko' ? 'euc-kr' : 'shift-jis', {
          fatal: true,
        }).decode(raw);
      } catch {
        /* retain original name */
      }
    }
    names.set(original, decoded ?? original);
    at = next;
  }
  return names;
}
