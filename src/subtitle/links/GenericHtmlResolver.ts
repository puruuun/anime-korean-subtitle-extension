import type {
  SubtitleLinkResolver,
  ResolverContext,
  SubtitleLinkResolution,
} from './SubtitleLinkResolver';
import type { SubtitleResource } from './resourceLoader';
import { DirectFileResolver, fileName, subtitleExtension } from './DirectFileResolver';
import { normalizeEpisode, filenameEpisode } from '../../anime/episodeNormalizer';
import { driveFileID, loadDriveFile } from './GoogleDriveResolver';
import { htmlLinks, elementHTML, type HTMLLink } from './html';
import { verifyFileEpisode } from './fileValidation';
export function subtitleLinks(html: string, base: string): HTMLLink[] {
  const body = elementHTML(html, 'post-body') ?? elementHTML(html, 'contents_style') ?? html;
  return [
    ...new Map(
      htmlLinks(body, base)
        .filter(
          (link) =>
            !/폰트|\bfonts?\b/i.test(
              link.label + ' ' + link.downloadName + ' ' + fileName(link.url),
            ) &&
            (subtitleExtension.test(fileName(link.url)) ||
              subtitleExtension.test(link.downloadName) ||
              driveFileID(link.url)),
        )
        .map((link) => [link.url, link]),
    ).values(),
  ];
}
export function htmlSubtitleLinks(html: string, base: string): string[] {
  return subtitleLinks(html, base).map((link) => link.url);
}
export function linkEpisode(url: string, season?: number): string | undefined {
  return filenameEpisode(fileName(url), season)?.episode;
}
function labelEpisodes(label: string): string[] {
  const single = normalizeEpisode(label.replace(/\s*(?:자막|subtitles?)\s*$/i, ''));
  if (single !== undefined) return [single];
  const range = label.match(
    /^\s*(\d+)\s*[-~～〜]\s*(\d+)\s*(?:화|話|회)?\s*(?:자막|subtitles?)?\s*$/i,
  );
  if (!range || Number(range[2]) < Number(range[1]) || Number(range[2]) - Number(range[1]) > 500)
    return [];
  return Array.from({ length: Number(range[2]) - Number(range[1]) + 1 }, (_, i) =>
    String(Number(range[1]) + i),
  );
}
export class GenericHtmlResolver implements SubtitleLinkResolver {
  id = 'generic-html';
  async resolve(
    resource: SubtitleResource,
    context: ResolverContext,
  ): Promise<SubtitleLinkResolution> {
    const charset =
      (resource.headers.get('content-type') ?? '').match(/charset\s*=\s*["']?([^\s;"']+)/i)?.[1] ??
      'utf-8';
    let html: string;
    try {
      html = new TextDecoder(charset).decode(resource.bytes);
    } catch {
      html = new TextDecoder().decode(resource.bytes);
    }
    const links = subtitleLinks(html, resource.url);
    const allowed = context.candidate.fileEpisodes ?? [normalizeEpisode(context.candidate.episode)];
    const episodes = (link: HTMLLink) =>
      [
        linkEpisode(link.url, context.candidate.season),
        filenameEpisode(link.downloadName, context.candidate.season)?.episode,
        ...labelEpisodes(link.label),
      ].filter((episode): episode is string => episode !== undefined);
    const matching = links.filter((link) =>
      episodes(link).some((episode) => allowed.includes(episode)),
    );
    // A latest-episode ZIP and an untitled batch ZIP can coexist. Inspect the sole batch,
    // but require an exact internal filename match before accepting it.
    const batches = links.filter(
      (link) =>
        !episodes(link).length &&
        (/\.zip$/i.test(fileName(link.url)) || /\.zip$/i.test(link.downloadName)),
    );
    const batch = !matching.length && batches.length === 1 ? batches[0] : undefined;
    const chosen =
      matching.length === 1 ? matching[0] : (batch ?? (links.length === 1 ? links[0] : undefined));
    const pageUrl = context.candidate.pageUrl ?? resource.url;
    if (!chosen)
      return {
        kind: 'page',
        pageUrl,
        message: links.length
          ? '자막 파일이 여러 개라 회차를 확정할 수 없습니다. 배포 페이지에서 선택하세요.'
          : '직접 자막 파일을 찾지 못했습니다. 배포 페이지에서 확인하세요.',
      };
    const knownEpisode = linkEpisode(chosen.url, context.candidate.season);
    if (
      knownEpisode !== undefined &&
      !allowed.includes(knownEpisode) &&
      !/\.zip$/i.test(fileName(chosen.url))
    )
      return {
        kind: 'page',
        pageUrl,
        message: '발견한 파일의 회차가 다릅니다. 배포 페이지에서 확인하세요.',
      };
    const resolved = driveFileID(chosen.url)
      ? await loadDriveFile(chosen.url, context)
      : await new DirectFileResolver().resolve(await context.load(chosen.url, context.signal));
    if (
      resolved &&
      verifyFileEpisode(
        resolved,
        batch ? { ...context.candidate, requireEpisodeMatch: true } : context.candidate,
      )
    )
      return resolved;
    return {
      kind: 'page',
      pageUrl,
      message: resolved
        ? '발견한 파일의 회차가 다릅니다. 배포 페이지에서 확인하세요.'
        : '파일 링크가 HTML 페이지를 반환했습니다. 배포 페이지에서 확인하세요.',
    };
  }
}
