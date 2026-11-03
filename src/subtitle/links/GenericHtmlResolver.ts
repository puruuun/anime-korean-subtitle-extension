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

const ATTACHMENT_URL_PATTERN =
  /(?:^|\.)(?:kakaocdn\.net|tistory\.com)\/(?:attach|dn)\/|(?:^|\.)blogattach\.naver\.net\//i;
const SUBTITLE_KEYWORD_OR_EXT =
  /(?:자막|합본|통합본|전편|완결|\.zip|\.smi|\.ass|\.srt|\.ssa|\.vtt)/i;
const BATCH_KEYWORD = /(?:합본|통합본|전편|완결|모음|전체|batch|complete|full)/i;

export function cleanLabel(label: string): string {
  return label.replace(/\s+\d+(?:\.\d+)?\s*[KMGT]?B\s*$/i, '').trim();
}

export function rangeEpisodes(text: string): string[] {
  const match =
    text.match(/(\d+)\s*[-~～〜]\s*(\d+)\s*(?:화|話|회|편)?/i) ??
    text.match(/\b(?:ep?|e)(\d+)\s*[-~～〜]\s*(?:ep?|e)?(\d+)\b/i);
  if (!match) return [];
  const start = Number(match[1]);
  const end = Number(match[2]);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start || end - start > 500) {
    return [];
  }
  if (!match[0].match(/(?:화|話|회|편|ep|e)/i) && start >= 1900) return [];
  return Array.from({ length: end - start + 1 }, (_, i) => String(start + i));
}

function linkExtensionRank(link: HTMLLink): number {
  const getExt = (str: string): string => {
    const m = str.match(/\.(smi|srt|ass|ssa|vtt|zip)(?:[?#]|$)/i);
    return m ? m[1].toLowerCase() : '';
  };
  const ext =
    getExt(link.downloadName) || getExt(fileName(link.url)) || getExt(cleanLabel(link.label));
  switch (ext) {
    case 'smi':
      return 6;
    case 'srt':
      return 5;
    case 'ass':
      return 4;
    case 'ssa':
      return 3;
    case 'vtt':
      return 2;
    case 'zip':
      return 1;
    default:
      return 0;
  }
}

export function subtitleLinks(html: string, base: string): HTMLLink[] {
  const body = elementHTML(html, 'post-body') ?? elementHTML(html, 'contents_style') ?? html;
  return [
    ...new Map(
      htmlLinks(body, base)
        .filter((link) => {
          const font = /폰트|\bfonts?\b/i.test(
            link.label + ' ' + link.downloadName + ' ' + fileName(link.url),
          );
          if (font) return false;
          const cleaned = cleanLabel(link.label);
          const hasDirectExt =
            subtitleExtension.test(fileName(link.url)) ||
            subtitleExtension.test(link.downloadName) ||
            subtitleExtension.test(cleaned);
          const isDrive = Boolean(driveFileID(link.url));
          const isAttachment =
            ATTACHMENT_URL_PATTERN.test(link.url) &&
            SUBTITLE_KEYWORD_OR_EXT.test(cleaned + ' ' + link.downloadName);
          return hasDirectExt || isDrive || isAttachment;
        })
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

function labelEpisodes(label: string, season?: number): string[] {
  const cleaned = cleanLabel(label);
  const ranges = rangeEpisodes(cleaned);
  if (ranges.length) return ranges;
  const single = normalizeEpisode(cleaned.replace(/\s*(?:자막|subtitles?)\s*$/i, ''));
  if (single !== undefined) return [single];
  const fromFilename = filenameEpisode(cleaned, season)?.episode;
  if (fromFilename !== undefined) return [fromFilename];
  return [];
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
    const isZip = (link: HTMLLink) =>
      /\.zip$/i.test(fileName(link.url)) ||
      /\.zip$/i.test(link.downloadName) ||
      /\.zip$/i.test(cleanLabel(link.label));

    const episodes = (link: HTMLLink): string[] => {
      const cleaned = cleanLabel(link.label);
      const ranges = [
        ...rangeEpisodes(cleaned),
        ...rangeEpisodes(link.downloadName),
        ...rangeEpisodes(fileName(link.url)),
      ];
      if (ranges.length) return ranges;
      return [
        linkEpisode(link.url, context.candidate.season),
        filenameEpisode(link.downloadName, context.candidate.season)?.episode,
        ...labelEpisodes(link.label, context.candidate.season),
      ].filter((episode): episode is string => episode !== undefined);
    };

    const matching = links.filter((link) =>
      episodes(link).some((episode) => allowed.includes(episode)),
    );

    if (matching.length > 1) {
      matching.sort((a, b) => linkExtensionRank(b) - linkExtensionRank(a));
    }

    const batches = links.filter(
      (link) =>
        !episodes(link).length &&
        (isZip(link) || BATCH_KEYWORD.test(cleanLabel(link.label) + ' ' + link.downloadName)),
    );

    let batch: HTMLLink | undefined;
    if (!matching.length) {
      if (batches.length === 1) {
        batch = batches[0];
      } else if (batches.length > 1) {
        const keywordBatches = batches.filter((b) =>
          BATCH_KEYWORD.test(`${cleanLabel(b.label)} ${b.downloadName} ${fileName(b.url)}`),
        );
        if (keywordBatches.length === 1) {
          batch = keywordBatches[0];
        }
      }
    }

    const chosen =
      matching.length > 0 ? matching[0] : (batch ?? (links.length === 1 ? links[0] : undefined));

    const pageUrl = context.candidate.pageUrl ?? resource.url;
    if (!chosen)
      return {
        kind: 'page',
        pageUrl,
        message: links.length
          ? '자막 파일이 여러 개라 회차를 확정할 수 없습니다. 배포 페이지에서 선택하세요.'
          : '직접 자막 파일을 찾지 못했습니다. 배포 페이지에서 확인하세요.',
      };

    const knownEpisode =
      linkEpisode(chosen.url, context.candidate.season) ??
      filenameEpisode(chosen.downloadName, context.candidate.season)?.episode ??
      filenameEpisode(cleanLabel(chosen.label), context.candidate.season)?.episode;
    if (knownEpisode !== undefined && !allowed.includes(knownEpisode) && !isZip(chosen))
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
