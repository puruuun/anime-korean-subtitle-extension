import type {
  ResolvedSubtitleFile,
  ResolverContext,
  SubtitleLinkResolver,
} from './SubtitleLinkResolver';
import type { SubtitleResource } from './resourceLoader';
import { subtitleURL } from './resourceLoader';
import { DirectFileResolver } from './DirectFileResolver';
import { attribute, staticHTML } from './html';
import { AppError } from '../../utils/errors';
export function driveFileID(value: string): string | undefined {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.hostname !== 'drive.google.com') return undefined;
    const id =
      url.pathname.match(/^\/file\/d\/([\w-]+)(?:\/|$)/)?.[1] ??
      (/^\/(?:open|uc)$/.test(url.pathname) ? url.searchParams.get('id') : undefined);
    return id && /^[\w-]{10,200}$/.test(id) ? id : undefined;
  } catch {
    return undefined;
  }
}
export async function loadDriveFile(
  value: string,
  context: ResolverContext,
): Promise<ResolvedSubtitleFile> {
  const id = driveFileID(value);
  if (!id) throw new AppError('DRIVE_URL', 'Google Drive 파일 주소를 확인하세요.');
  const download = new URL('https://drive.usercontent.google.com/download');
  download.searchParams.set('id', id);
  download.searchParams.set('export', 'download');
  const resourceKey = new URL(value).searchParams.get('resourcekey');
  if (resourceKey) download.searchParams.set('resourcekey', resourceKey);
  let url = download.href;
  for (let attempt = 0; attempt < 2; attempt++) {
    const resource = await context.load(url, context.signal);
    const file = await new DirectFileResolver().resolve(resource);
    if (file) return file;
    const html = staticHTML(new TextDecoder().decode(resource.bytes));
    const form = html.match(/<form\b((?:[^>"']|"[^"]*"|'[^']*')*)>([\s\S]*?)<\/form\s*>/i);
    const action = form && attribute(form[1], 'action');
    const method = form && attribute(form[1], 'method');
    if (!form || !action || (method && method.toLowerCase() !== 'get')) break;
    const next = new URL(subtitleURL(action, resource.url));
    if (next.origin !== download.origin || next.pathname !== '/download') break;
    const params = new URLSearchParams();
    for (const input of form[2].matchAll(/<input\b((?:[^>"']|"[^"]*"|'[^']*')*)>/gi)) {
      const name = attribute(input[1], 'name'),
        v = attribute(input[1], 'value');
      if (
        name &&
        v !== undefined &&
        /^(?:id|export|confirm|uuid|resourcekey)$/.test(name) &&
        v.length <= 2048
      )
        params.set(name, v);
    }
    if (params.get('id') !== id || params.get('export') !== 'download' || !params.get('confirm'))
      break;
    next.search = params.toString();
    url = next.href;
  }
  throw new AppError(
    'DRIVE_UNAVAILABLE',
    'Google Drive 파일을 내려받지 못했습니다. 공유 권한·삭제·다운로드 제한을 배포 페이지에서 확인하세요.',
  );
}
export class GoogleDriveResolver implements SubtitleLinkResolver {
  id = 'google-drive';
  async resolve(resource: SubtitleResource, context: ResolverContext) {
    if (!driveFileID(resource.url)) return undefined;
    return loadDriveFile(resource.url, context);
  }
}
