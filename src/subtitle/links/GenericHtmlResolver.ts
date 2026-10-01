import type {
  SubtitleLinkResolver,
  ResolverContext,
  SubtitleLinkResolution,
} from './SubtitleLinkResolver';
import type { SubtitleResource } from './resourceLoader';
import { subtitleURL } from './resourceLoader';
import { DirectFileResolver, fileName, subtitleExtension } from './DirectFileResolver';
import { plainText } from '../SubtitleParser';
import { normalizeEpisode, episodeFromSubtitleName } from '../../anime/episodeNormalizer';

export function htmlSubtitleLinks(html: string, base: string): string[] {
  // Worker-safe extraction: only static anchors; never execute a page's scripts.
  const content = html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '');
  const urls: string[] = [];
  for (const match of content.matchAll(/<a\b((?:[^>"']|"[^"]*"|'[^']*')*)>/gi)) {
    const attributes = match[1];
    const href = attributes.match(/(?:^|\s)href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>]+))/i);
    if (!href) continue;
    const download = attributes.match(
      /(?:^|\s)download\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>]+))/i,
    );
    try {
      const url = subtitleURL(plainText(href.slice(1).find((v) => v !== undefined) ?? ''), base);
      const downloadName = plainText(download?.slice(1).find((v) => v !== undefined) ?? '');
      if (subtitleExtension.test(fileName(url)) || subtitleExtension.test(downloadName))
        urls.push(url);
    } catch {
      /* Ignore nonpublic and non-HTTP links. */
    }
  }
  return [...new Set(urls)];
}
export function linkEpisode(url: string): string | undefined {
  return episodeFromSubtitleName(fileName(url));
}
export class GenericHtmlResolver implements SubtitleLinkResolver {
  id = 'generic-html';
  async resolve(
    resource: SubtitleResource,
    context: ResolverContext,
  ): Promise<SubtitleLinkResolution> {
    const type = resource.headers.get('content-type') ?? '';
    const charset = type.match(/charset\s*=\s*["']?([^\s;"']+)/i)?.[1] ?? 'utf-8';
    let html: string;
    try {
      html = new TextDecoder(charset).decode(resource.bytes);
    } catch {
      html = new TextDecoder().decode(resource.bytes);
    }
    const links = htmlSubtitleLinks(html, resource.url);
    const episode = normalizeEpisode(context.candidate.episode);
    const allowed = context.candidate.fileEpisodes ?? [episode];
    const matching = links.filter((url) => allowed.includes(linkEpisode(url)));
    const chosen = matching.length === 1 ? matching[0] : links.length === 1 ? links[0] : undefined;
    const pageUrl = context.candidate.pageUrl ?? resource.url;
    if (!chosen)
      return {
        kind: 'page',
        pageUrl,
        message: links.length
          ? '자막 파일이 여러 개라 회차를 확정할 수 없습니다. 배포 페이지에서 선택하세요.'
          : '직접 자막 파일을 찾지 못했습니다. 배포 페이지에서 확인하세요.',
      };
    const knownEpisode = linkEpisode(chosen);
    if (
      knownEpisode !== undefined &&
      !allowed.includes(knownEpisode) &&
      !/\.zip$/i.test(fileName(chosen))
    )
      return {
        kind: 'page',
        pageUrl,
        message: '발견한 파일의 회차가 다릅니다. 배포 페이지에서 확인하세요.',
      };
    const file = await context.load(chosen, context.signal);
    const resolved = await new DirectFileResolver().resolve(file);
    return (
      resolved ?? {
        kind: 'page',
        pageUrl,
        message: '파일 링크가 HTML 페이지를 반환했습니다. 배포 페이지에서 확인하세요.',
      }
    );
  }
}
