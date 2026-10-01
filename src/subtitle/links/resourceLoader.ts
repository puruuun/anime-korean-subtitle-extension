import { publicSubtitleURL } from '../../background/network';
import { AppError } from '../../utils/errors';
export interface SubtitleResource {
  url: string;
  headers: Headers;
  bytes: Uint8Array;
}
export class SubtitleHostPermission extends AppError {
  constructor(public origin: string) {
    super('SUBTITLE_HOST', '자막 배포 페이지·파일 도메인의 접근 허용이 필요합니다.');
  }
}
export function subtitleURL(value: string, base?: string) {
  return publicSubtitleURL(new URL(value, base).href, true);
}
export function subtitleOrigin(url: string) {
  return new URL(subtitleURL(url)).origin.replace(/:\d+$/, '') + '/*';
}
async function browserAccess(origin: string) {
  return (
    typeof chrome !== 'undefined' &&
    !!chrome.permissions &&
    (await chrome.permissions.contains({ origins: [origin] }))
  );
}
export function createResourceLoader(
  canAccess: (origin: string) => Promise<boolean> = browserAccess,
) {
  return async (value: string, signal?: AbortSignal): Promise<SubtitleResource> => {
    let url = subtitleURL(value);
    const controller = new AbortController();
    const abort = () => controller.abort(signal?.reason);
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    const timeout = setTimeout(
      () => controller.abort(new AppError('TIMEOUT', '자막 응답 시간이 초과되었습니다.')),
      20000,
    );
    try {
      for (let redirects = 0; redirects < 6; redirects++) {
        controller.signal.throwIfAborted();
        const origin = subtitleOrigin(url);
        if (!(await canAccess(origin))) throw new SubtitleHostPermission(origin);
        const response = await fetch(url, {
          signal: controller.signal,
          credentials: 'omit',
          referrerPolicy: 'no-referrer',
          redirect: 'manual',
        });
        if (response.type === 'opaqueredirect') {
          throw new AppError(
            'REDIRECT',
            '배포 페이지의 이동 주소를 확인할 수 없습니다. 페이지에서 자막을 확인하세요.',
          );
        }
        if (response.status >= 300 && response.status < 400) {
          await response.body?.cancel();
          const location = response.headers.get('location');
          if (!location)
            throw new AppError('REDIRECT', '배포 페이지의 이동 주소를 확인할 수 없습니다.');
          url = subtitleURL(location, url);
          continue;
        }
        if (!response.ok) {
          await response.body?.cancel();
          throw new AppError(
            'SUBTITLE_HTTP',
            '자막 페이지·파일 요청에 실패했습니다. (HTTP ' + response.status + ')',
          );
        }
        if (/^(?:video|audio)\//i.test(response.headers.get('content-type') ?? '')) {
          await response.body?.cancel();
          throw new AppError('FORMAT', '영상·오디오 응답은 처리하지 않습니다.');
        }
        const limit = 8 * 1024 * 1024;
        if (Number(response.headers.get('content-length')) > limit) {
          await response.body?.cancel();
          throw new AppError('SIZE', '자막 페이지·파일이 너무 큽니다.');
        }
        const chunks: Uint8Array[] = [];
        const reader = response.body?.getReader();
        let size = 0;
        if (reader)
          for (;;) {
            const part = await reader.read();
            if (part.done) break;
            size += part.value.byteLength;
            if (size > limit) {
              await reader.cancel();
              throw new AppError('SIZE', '자막 페이지·파일이 너무 큽니다.');
            }
            chunks.push(part.value);
          }
        const bytes = new Uint8Array(size);
        let offset = 0;
        for (const part of chunks) {
          bytes.set(part, offset);
          offset += part.length;
        }
        return { url, headers: response.headers, bytes };
      }
      throw new AppError('REDIRECT', '자막 페이지의 이동이 너무 많습니다.');
    } catch (e) {
      signal?.throwIfAborted();
      controller.signal.throwIfAborted();
      if (e instanceof AppError) throw e;
      throw new AppError(
        'SUBTITLE_CONNECTION',
        '자막 페이지·파일에 연결할 수 없습니다. 페이지에서 확인하세요.',
      );
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener('abort', abort);
    }
  };
}
