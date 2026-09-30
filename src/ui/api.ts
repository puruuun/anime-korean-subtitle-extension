export async function send<T = Record<string, unknown>>(message: unknown): Promise<T> {
  const response = await chrome.runtime.sendMessage(message);
  if (!response?.ok) throw Error(response?.error ?? '확장프로그램 응답이 없습니다.');
  return response as T;
}
export function originPattern(url: string) {
  const u = new URL(url);
  return ['http:', 'https:'].includes(u.protocol)
    ? u.origin.replace(/:\d+$/, '') + '/*'
    : undefined;
}
export async function requestHost(url: string) {
  const origin = originPattern(url);
  if (!origin) throw Error('HTTP / HTTPS 주소를 입력하세요.');
  if (await chrome.permissions.contains({ origins: [origin] })) return;
  const allowed = await chrome.permissions.request({ origins: [origin] });
  if (!allowed) throw Error('서버 접근 권한이 허용되지 않았습니다.');
}
