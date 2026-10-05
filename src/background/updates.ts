import { AppError } from '../utils/errors';
const REPOSITORY = 'puruuun/anime-korean-subtitle-extension';
export const RELEASES_URL = `https://github.com/${REPOSITORY}/releases`;
export const LATEST_RELEASE_API = `https://api.github.com/repos/${REPOSITORY}/releases/latest`;
const TOKEN_KEY = 'githubUpdateToken';
const CACHE_KEY = 'githubUpdateCheck';
export interface UpdateStatus {
  state: 'unchecked' | 'latest' | 'available' | 'ahead' | 'error';
  currentVersion: string;
  latestVersion?: string;
  releaseName?: string;
  releaseUrl: string;
  checkedAt?: number;
  publishedAt?: string;
  message: string;
  cached?: boolean;
}
type CachedCheck = Omit<UpdateStatus, 'currentVersion'> & { expiresAt: number };
let pending:
  | { token: string; controller: AbortController; promise: Promise<UpdateStatus> }
  | undefined;

export function releaseVersion(tag: unknown): string | undefined {
  if (typeof tag !== 'string' || !/^v?\d+(?:\.\d+){0,3}$/.test(tag)) return;
  const parts = tag.replace(/^v/, '').split('.').map(Number);
  if (parts.some((part) => !Number.isSafeInteger(part) || part > 65535)) return;
  return parts.join('.');
}
export function compareVersions(a: string, b: string): number {
  const left = a.split('.').map(Number),
    right = b.split('.').map(Number);
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    const difference = (left[i] ?? 0) - (right[i] ?? 0);
    if (difference) return Math.sign(difference);
  }
  return 0;
}
function installedVersion() {
  return chrome.runtime.getManifest().version;
}
function result(cached: CachedCheck): UpdateStatus {
  const { expiresAt: _expiresAt, ...status } = cached;
  const currentVersion = installedVersion();
  if (cached.state === 'error' || !cached.latestVersion) return { ...status, currentVersion };
  const order = compareVersions(currentVersion, cached.latestVersion);
  return {
    ...status,
    currentVersion,
    state: order < 0 ? 'available' : order > 0 ? 'ahead' : 'latest',
    message:
      order < 0
        ? `새 버전 ${cached.latestVersion}이 있습니다. 업데이트가 필요합니다.`
        : order > 0
          ? '설치된 버전이 GitHub의 최신 정식 Release보다 앞선 개발 버전입니다.'
          : '최신 버전을 사용하고 있습니다.',
  };
}
export async function updateConnection() {
  const data = await chrome.storage.local.get(TOKEN_KEY);
  return { tokenConfigured: typeof data[TOKEN_KEY] === 'string' && !!data[TOKEN_KEY] };
}
export async function saveUpdateToken(value: unknown) {
  if (typeof value !== 'string' || value.length > 4096 || (value.trim() && /\s/.test(value.trim())))
    throw new AppError('INVALID_UPDATE_TOKEN', 'GitHub 토큰 형식을 확인하세요.');
  pending?.controller.abort();
  pending = undefined;
  if (value.trim()) await chrome.storage.local.set({ [TOKEN_KEY]: value.trim() });
  else await chrome.storage.local.remove(TOKEN_KEY);
  await chrome.storage.local.remove(CACHE_KEY);
  return updateConnection();
}
export async function checkUpdates(force = false): Promise<UpdateStatus> {
  const data = await chrome.storage.local.get([TOKEN_KEY, CACHE_KEY]);
  const token = typeof data[TOKEN_KEY] === 'string' ? data[TOKEN_KEY] : '';
  if (pending?.token === token) return pending.promise;
  const cached = data[CACHE_KEY] as CachedCheck | undefined;
  if (!force && cached?.expiresAt && cached.expiresAt > Date.now())
    return { ...result(cached), cached: true };
  const controller = new AbortController();
  const task = { token, controller, promise: Promise.resolve({} as UpdateStatus) };
  task.promise = (async () => {
    const base: CachedCheck = {
      state: 'error',
      releaseUrl: RELEASES_URL,
      checkedAt: Date.now(),
      expiresAt: 0,
      message: '',
    };
    const timer = setTimeout(() => controller.abort(), 10000);
    try {
      if (!(await chrome.permissions.contains({ origins: ['https://api.github.com/*'] })))
        throw Error(
          'GitHub 사이트 접근이 차단되어 있습니다. 위 권한 가이드대로 사이트 접근을 허용하세요.',
        );
      const response = await fetch(LATEST_RELEASE_API, {
        headers: {
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2026-03-10',
          ...(token ? { Authorization: 'Bearer ' + token } : {}),
        },
        signal: controller.signal,
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
        redirect: 'error',
      });
      if (!response.ok) {
        if (response.status === 404)
          throw Error(
            token
              ? 'Release를 읽을 수 없습니다. 토큰의 저장소 선택·Contents 읽기 권한과 Release 존재 여부를 확인하세요.'
              : '비공개 저장소는 GitHub 읽기 전용 토큰을 연결해야 업데이트를 확인할 수 있습니다. 아래 연결 안내를 따라주세요. 공개 저장소도 아직 Release가 없으면 확인할 수 없습니다.',
          );
        if (response.status === 401)
          throw Error(
            'GitHub 인증에 실패했습니다. 토큰이 만료·삭제되었는지 확인하고 다시 연결하세요.',
          );
        if (
          response.status === 429 ||
          (response.status === 403 && response.headers.get('x-ratelimit-remaining') === '0')
        )
          throw Error('GitHub 요청 한도에 도달했습니다. 잠시 후 다시 확인하세요.');
        if (response.status === 403)
          throw Error(
            'GitHub 읽기 권한이 부족합니다. 저장소 선택과 Contents: Read-only 권한을 확인하세요.',
          );
        throw Error(
          `GitHub에 연결하지 못했습니다. (HTTP ${response.status}) 잠시 후 다시 확인하세요.`,
        );
      }
      const release = (await response.json()) as Record<string, unknown>;
      const version = releaseVersion(release.tag_name);
      if (!version || release.draft !== false || release.prerelease !== false)
        throw Error('정식 Release 버전을 비교할 수 없습니다. GitHub Release에서 직접 확인하세요.');
      Object.assign(base, {
        state: 'latest',
        latestVersion: version,
        releaseName:
          typeof release.name === 'string' ? release.name.slice(0, 200) : String(release.tag_name),
        releaseUrl: `${RELEASES_URL}/tag/${encodeURIComponent(String(release.tag_name))}`,
        publishedAt: typeof release.published_at === 'string' ? release.published_at : undefined,
      });
    } catch (e) {
      base.message = controller.signal.aborted
        ? '업데이트 확인 시간이 초과되었거나 연결 설정이 변경되었습니다. 다시 확인하세요.'
        : e instanceof TypeError
          ? 'GitHub에 연결할 수 없습니다. 인터넷 연결과 Chrome 사이트 접근 설정을 확인하세요.'
          : e instanceof Error
            ? e.message
            : '업데이트를 확인하지 못했습니다. 다시 확인하세요.';
    } finally {
      clearTimeout(timer);
    }
    base.expiresAt = Date.now() + (base.state === 'error' ? 60000 : 600000);
    if (pending === task && !controller.signal.aborted)
      await chrome.storage.local.set({ [CACHE_KEY]: base });
    return result(base);
  })();
  pending = task;
  try {
    return await task.promise;
  } finally {
    if (pending === task) pending = undefined;
  }
}
