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
  const manifest = chrome.runtime.getManifest();
  const required = manifest.host_permissions?.some((pattern: string) => {
    if (pattern === '<all_urls>') return true;
    try {
      const target = new URL(origin.replace(/\*$/, ''));
      const match = pattern.match(/^(https?|\*):\/\/([^/]+)\//);
      if (!match || (match[1] !== '*' && match[1] + ':' !== target.protocol)) return false;
      return (
        match[2] === '*' ||
        match[2] === target.hostname ||
        (match[2].startsWith('*.') &&
          (target.hostname === match[2].slice(2) ||
            target.hostname.endsWith('.' + match[2].slice(2))))
      );
    } catch {
      return false;
    }
  });
  if (required)
    throw Error(
      '설치 권한이 Chrome에서 차단되어 있습니다. 확장 세부정보의 사이트 접근을 허용한 뒤 새로고침하세요.',
    );
  const allowed = await chrome.permissions.request({ origins: [origin] });
  if (!allowed) throw Error('서버 접근 권한이 허용되지 않았습니다.');
}
