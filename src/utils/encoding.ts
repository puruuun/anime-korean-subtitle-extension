import { AppError } from './errors';
export function decodeSubtitle(bytes: Uint8Array, language = 'en'): string {
  let labels: string[] = [];
  if (bytes[0] === 0xff && bytes[1] === 0xfe) labels = ['utf-16le'];
  else if (bytes[0] === 0xfe && bytes[1] === 0xff) labels = ['utf-16be'];
  else if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) labels = ['utf-8'];
  else
    labels = [
      'utf-8',
      ...(language === 'ko' ? ['euc-kr'] : language === 'ja' ? ['shift-jis'] : []),
    ];
  for (const label of labels) {
    try {
      const text = new TextDecoder(label, { fatal: true }).decode(bytes).replace(/^\uFEFF/, '');
      if (text.includes('\uFFFD') || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(text))
        continue;
      if (label !== 'utf-8' && !label.startsWith('utf-16')) {
        if (language === 'ja' && !/[\u3040-\u30ff\u4e00-\u9fff]/.test(text)) continue;
        if (language === 'ko' && !/[\uac00-\ud7a3]/.test(text)) continue;
      }
      return text;
    } catch {}
  }
  throw new AppError(
    'ENCODING',
    '자막 인코딩을 읽을 수 없습니다. UTF-8 / UTF-16 / CP949 / Shift-JIS 파일을 확인하세요.',
  );
}
