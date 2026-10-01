import type { SubtitleLinkResolver, ResolvedSubtitleFile } from './SubtitleLinkResolver';
import type { SubtitleResource } from './resourceLoader';
export const subtitleExtension = /\.(smi|srt|ass|ssa|vtt|zip)$/i;
export function fileName(url: string) {
  try {
    return decodeURIComponent(new URL(url).pathname.split('/').at(-1) ?? '');
  } catch {
    return '';
  }
}
function dispositionName(value: string) {
  const encoded = value.match(/filename\*\s*=\s*UTF-8''([^;]+)/i)?.[1];
  if (encoded) {
    try {
      return decodeURIComponent(encoded.trim().replace(/^"|"$/g, ''));
    } catch {
      /* plain filename below */
    }
  }
  return (
    value
      .match(/filename\s*=\s*(?:"([^"]+)"|([^;]+))/i)
      ?.slice(1)
      .find(Boolean)
      ?.trim() ?? ''
  );
}
export class DirectFileResolver implements SubtitleLinkResolver {
  id = 'direct-file';
  async resolve(resource: SubtitleResource): Promise<ResolvedSubtitleFile | undefined> {
    const sample = new TextDecoder().decode(resource.bytes.slice(0, 8192)).replace(/^\uFEFF/, '');
    const sami = /<sami(?:\s|>)/i.test(sample) || /<sync\s[^>]*start\s*=/i.test(sample);
    if (!sami && /<(?:!doctype\s+html|html|head|body)(?:\s|>)/i.test(sample)) return undefined;
    const contentType =
      resource.headers.get('content-type')?.split(';')[0].trim().toLowerCase() ?? '';
    if (!sami && /(?:text\/html|application\/xhtml\+xml)/i.test(contentType)) return undefined;
    const headerName = dispositionName(resource.headers.get('content-disposition') ?? '');
    const name = headerName || fileName(resource.url);
    const mimeFormat: Record<string, string> = {
      'application/x-subrip': 'srt',
      'text/srt': 'srt',
      'text/vtt': 'vtt',
      'text/x-ass': 'ass',
      'application/x-ass': 'ass',
      'text/x-ssa': 'ssa',
      'application/x-sami': 'smi',
      'text/sami': 'smi',
      'application/zip': 'zip',
      'application/x-zip-compressed': 'zip',
    };
    const zip = resource.bytes[0] === 0x50 && resource.bytes[1] === 0x4b;
    const format = zip
      ? 'zip'
      : sami
        ? 'smi'
        : /^WEBVTT/m.test(sample)
          ? 'vtt'
          : /^\[(?:Script Info|Events)\]/im.test(sample)
            ? 'ass'
            : /\d{1,2}:\d{2}(?::\d{2})?[.,]\d+\s+-->\s+\d{1,2}:\d{2}/.test(sample)
              ? 'srt'
              : mimeFormat[contentType];
    if (!format && !subtitleExtension.test(name)) return undefined;
    return {
      kind: 'file',
      url: resource.url,
      name: subtitleExtension.test(name) ? name : 'subtitle.' + format,
      buffer: resource.bytes.slice().buffer,
    };
  }
}
