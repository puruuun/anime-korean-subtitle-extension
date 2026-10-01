import { AppError } from '../utils/errors';
export async function request(
  url: string,
  init: RequestInit = {},
  timeoutMs = 20000,
  signal?: AbortSignal,
  subtitleOnly = false,
): Promise<ArrayBuffer> {
  const u = new URL(url);
  if (!['https:', 'http:'].includes(u.protocol) || u.username || u.password)
    throw new AppError('URL', '요청 주소가 잘못되었습니다.');
  const controller = new AbortController();
  const abort = () => controller.abort(signal?.reason);
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) abort();
  const timer = setTimeout(
    () => controller.abort(new AppError('TIMEOUT', '서버 응답 시간이 초과되었습니다.', true)),
    timeoutMs,
  );
  try {
    const response = await fetch(url, {
      ...init,
      signal: controller.signal,
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
    });
    if (!response.ok)
      throw new AppError(
        'HTTP_' + response.status,
        response.status === 401 || response.status === 403
          ? 'API 인증에 실패했습니다. API Key / Token을 확인하세요.'
          : response.status === 404
            ? '모델 또는 API 경로를 찾을 수 없습니다.'
            : 'API 요청에 실패했습니다. (HTTP ' + response.status + ')',
        response.status === 429 || response.status >= 500,
      );
    if (subtitleOnly && /^(?:video|audio)\//i.test(response.headers.get('content-type') ?? '')) {
      await response.body?.cancel();
      throw new AppError('FORMAT', '영상·오디오 응답은 처리하지 않습니다.');
    }
    const length = Number(response.headers.get('content-length'));
    if (length > 8 * 1024 * 1024) throw new AppError('SIZE', '응답 파일이 너무 큽니다.');
    const reader = response.body?.getReader();
    if (!reader) return new ArrayBuffer(0);
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const r = await reader.read();
      if (r.done) break;
      size += r.value.byteLength;
      if (size > 8 * 1024 * 1024) {
        await reader.cancel();
        throw new AppError('SIZE', '응답 파일이 너무 큽니다.');
      }
      chunks.push(r.value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const c of chunks) {
      bytes.set(c, offset);
      offset += c.length;
    }
    return bytes.buffer;
  } catch (e) {
    if (signal?.aborted) throw signal.reason;
    if (controller.signal.aborted) throw controller.signal.reason;
    if (e instanceof AppError) throw e;
    throw new AppError(
      'CONNECTION',
      '서버에 연결할 수 없습니다. 서버 실행 상태와 접근 권한을 확인하세요.',
      true,
    );
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
}
export async function requestJSON<T>(
  url: string,
  init: RequestInit = {},
  timeoutMs = 20000,
  signal?: AbortSignal,
): Promise<T> {
  const data = await request(url, init, timeoutMs, signal);
  try {
    return JSON.parse(new TextDecoder().decode(data)) as T;
  } catch {
    throw new AppError('JSON', 'API 응답 형식이 잘못되었습니다.');
  }
}
export function publicSubtitleURL(value: string, allowHttp = false): string {
  const u = new URL(value);
  if (
    (u.protocol !== 'https:' && !(allowHttp && u.protocol === 'http:')) ||
    u.username ||
    u.password ||
    /(?:^|\.)(?:localhost|local|internal)$/.test(u.hostname) ||
    /^(0\.|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|22[4-9]\.|23\d\.|24\d\.|25[0-5]\.)/.test(
      u.hostname,
    ) ||
    u.hostname.startsWith('[')
  )
    throw new AppError('URL', '자막 리소스 주소가 허용되지 않습니다.');
  return u.href;
}
