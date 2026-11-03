import type {
  SubtitleLinkResolver,
  ResolverContext,
  SubtitleLinkResolution,
} from './SubtitleLinkResolver';
import type { SubtitleResource } from './resourceLoader';
import { subtitleURL, SubtitleHostPermission } from './resourceLoader';
import { GenericHtmlResolver } from './GenericHtmlResolver';
import { htmlLinks, attribute } from './html';
import { plainText } from '../SubtitleParser';
import { normalizeEpisode } from '../../anime/episodeNormalizer';
import { database } from '../../storage/database';
import { AppError } from '../../utils/errors';
import { blogSeriesTitle, postEpisodes, seriesKey } from './BlogspotResolver';

const TTL = 5 * 60 * 1000;
const BATCH_KEYWORD = /(?:합본|통합본|전편|완결|모음|전체|batch|complete|full)/i;

export interface NaverAttachFile {
  attachFileName?: string;
  encodedAttachFileName?: string;
  attachUrl?: string;
  attachFileSize?: number;
}

interface NaverPostEntry {
  title: string;
  url: string;
}

export function extractNaverPostFiles(html: string): NaverAttachFile[] {
  const match = html.match(/\baPostFiles\s*=\s*(\[\s*\{[\s\S]*?\}\s*\])\s*;/);
  if (!match) return [];
  try {
    return JSON.parse(match[1]);
  } catch {
    try {
      const raw = match[1];
      const items: NaverAttachFile[] = [];
      const itemMatches = raw.matchAll(/\{([^{}]+)\}/g);
      for (const m of itemMatches) {
        const attachFileName = m[1].match(/"attachFileName"\s*:\s*"([^"]+)"/)?.[1];
        const attachUrl = m[1].match(/"attachUrl"\s*:\s*"([^"]+)"/)?.[1]?.replace(/\\\//g, '/');
        if (attachUrl) {
          items.push({ attachFileName, attachUrl });
        }
      }
      return items;
    } catch {
      return [];
    }
  }
}

export function extractMainFrameSrc(html: string): string | undefined {
  const match = html.match(/<iframe\b[^>]*\b(?:id|name)\s*=\s*["']mainFrame["'][^>]*>/i);
  if (!match) return undefined;
  return attribute(match[0], 'src');
}

function extractBlogId(url: URL, html: string): string | undefined {
  const fromQuery = url.searchParams.get('blogId');
  if (fromQuery) return fromQuery;
  const parts = url.pathname.split('/').filter(Boolean);
  if (
    parts.length >= 1 &&
    !['PostView.naver', 'PostSearchList.naver', 'PostList.naver'].includes(parts[0])
  ) {
    return parts[0];
  }
  const fromHtml =
    html.match(/\bblogId\s*=\s*["']([^"']+)["']/i)?.[1] ??
    html.match(/name\s*=\s*["']blogId["'][^>]*value\s*=\s*["']([^"']+)["']/i)?.[1];
  return fromHtml;
}

function extractLogNo(urlStr: string): string | undefined {
  try {
    const u = new URL(urlStr);
    const q = u.searchParams.get('logNo');
    if (q) return q;
    const parts = u.pathname.split('/').filter(Boolean);
    if (parts.length >= 2 && !['PostView.naver', 'PostSearchList.naver'].includes(parts[0])) {
      return parts[1];
    }
  } catch {
    /* ignore */
  }
  return undefined;
}

function extractNaverTitle(html: string): string {
  const ogTitle =
    html.match(
      /<meta\b[^>]*property\s*=\s*["']og:title["'][^>]*content\s*=\s*["']([^"']+)["']/i,
    )?.[1] ??
    html.match(
      /<meta\b[^>]*content\s*=\s*["']([^"']+)["'][^>]*property\s*=\s*["']og:title["']/i,
    )?.[1];
  if (ogTitle) return plainText(ogTitle).trim();

  const titleMatch =
    html.match(
      /<span\b[^>]*\bclass\s*=\s*["'][^"']*\bitemSubjectBoldfont\b[^"']*["'][^>]*>([\s\S]*?)<\/span>/i,
    ) ??
    html.match(
      /<div\b[^>]*\bclass\s*=\s*["'][^"']*\bse-title-text\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/i,
    ) ??
    html.match(
      /<h3\b[^>]*\bclass\s*=\s*["'][^"']*\bse_textarea\b[^"']*["'][^>]*>([\s\S]*?)<\/h3>/i,
    );
  if (titleMatch) return plainText(titleMatch[1]).trim();

  const docTitle = html.match(/<title\b[^>]*>([\s\S]*?)<\/title\s*>/i)?.[1];
  if (docTitle) return plainText(docTitle).trim();

  return '';
}

function isSameSeries(title1: string, title2: string): boolean {
  const clean = (t: string) => seriesKey(t.replace(/\[[^\]]*\]|\([^)]*\)/g, ''));
  const k1 = seriesKey(title1);
  const k2 = seriesKey(title2);
  if (k1 && k2 && k1 === k2) return true;
  const c1 = clean(title1);
  const c2 = clean(title2);
  return Boolean(c1 && c2 && (c1 === c2 || c1.includes(c2) || c2.includes(c1)));
}

async function loadEffectiveResource(
  resource: SubtitleResource,
  context: ResolverContext,
): Promise<SubtitleResource> {
  const html = new TextDecoder().decode(resource.bytes);
  const mainFrameSrc = extractMainFrameSrc(html);
  if (mainFrameSrc) {
    const innerUrl = subtitleURL(mainFrameSrc, resource.url);
    return context.load(innerUrl, context.signal);
  }
  return resource;
}

async function resolvePageWithAttachments(
  resource: SubtitleResource,
  context: ResolverContext,
): Promise<SubtitleLinkResolution> {
  const html = new TextDecoder().decode(resource.bytes);
  let effectiveHtml = html;
  const files = extractNaverPostFiles(html);
  if (files.length) {
    const syntheticLinks = files
      .filter((f) => f.attachUrl)
      .map(
        (f) =>
          `<a href="${f.attachUrl}" download="${f.attachFileName ?? ''}">${f.attachFileName ?? '첨부파일'}</a>`,
      )
      .join('\n');
    effectiveHtml += `\n<div class="naver-synthetic-attachments">\n${syntheticLinks}\n</div>`;
  }
  const effectiveResource: SubtitleResource = {
    url: resource.url,
    headers: resource.headers,
    bytes: new TextEncoder().encode(effectiveHtml),
  };
  return new GenericHtmlResolver().resolve(effectiveResource, context);
}

export class NaverBlogResolver implements SubtitleLinkResolver {
  id = 'naver-blog';

  async resolve(
    resource: SubtitleResource,
    context: ResolverContext,
  ): Promise<SubtitleLinkResolution | undefined> {
    const url = new URL(resource.url);
    if (!/(?:^|\.)blog\.naver\.com$/i.test(url.hostname)) return undefined;

    let effectiveResource: SubtitleResource;
    try {
      effectiveResource = await loadEffectiveResource(resource, context);
    } catch (error) {
      context.signal?.throwIfAborted();
      if (error instanceof SubtitleHostPermission) throw error;
      return {
        kind: 'page',
        pageUrl: context.candidate.pageUrl ?? resource.url,
        message: error instanceof AppError ? error.message : '배포 페이지를 읽지 못했습니다.',
      };
    }

    let original: SubtitleLinkResolution;
    try {
      original = await resolvePageWithAttachments(effectiveResource, context);
      if (original.kind === 'file') return original;
    } catch (error) {
      context.signal?.throwIfAborted();
      if (error instanceof SubtitleHostPermission) throw error;
      original = {
        kind: 'page',
        pageUrl: context.candidate.pageUrl ?? resource.url,
        message: error instanceof AppError ? error.message : '배포 파일을 읽지 못했습니다.',
      };
    }

    const effectiveHtml = new TextDecoder().decode(effectiveResource.bytes);
    const postTitle = extractNaverTitle(effectiveHtml);
    let series = blogSeriesTitle(postTitle);
    if (!series) {
      series = blogSeriesTitle(context.candidate.matchedTitle ?? context.candidate.title);
    }

    const blogId =
      extractBlogId(new URL(effectiveResource.url), effectiveHtml) ??
      extractBlogId(url, new TextDecoder().decode(resource.bytes));
    if (!blogId || !series) return original;

    const cacheKey = JSON.stringify(['naver:series:v1', blogId, series]);
    const cached = await database
      .get<{ expiresAt: number; entries: NaverPostEntry[] }>(cacheKey)
      .catch(() => undefined);
    context.signal?.throwIfAborted();

    let entries = cached && cached.expiresAt > Date.now() ? cached.entries : undefined;

    if (!entries) {
      entries = [];
      const searchUrl = `https://blog.naver.com/PostSearchList.naver?blogId=${encodeURIComponent(
        blogId,
      )}&SearchText=${encodeURIComponent(series)}`;
      try {
        const searchResource = await context.load(searchUrl, context.signal);
        const searchHtml = new TextDecoder().decode(searchResource.bytes);
        const links = htmlLinks(searchHtml, searchUrl);
        const postMap = new Map<string, NaverPostEntry>();

        for (const l of links) {
          try {
            const u = new URL(l.url);
            if (!/(?:^|\.)blog\.naver\.com$/i.test(u.hostname)) continue;
            const logNo = extractLogNo(l.url);
            if (!logNo) continue;
            const cleanUrl = `https://blog.naver.com/PostView.naver?blogId=${encodeURIComponent(
              blogId,
            )}&logNo=${logNo}`;
            const titleText = l.label.trim();
            if (!titleText) continue;
            const existing = postMap.get(cleanUrl);
            if (!existing || titleText.length > existing.title.length) {
              postMap.set(cleanUrl, { title: titleText, url: cleanUrl });
            }
          } catch {
            /* ignore invalid search links */
          }
        }
        entries = Array.from(postMap.values());
        context.signal?.throwIfAborted();
        await database.put(cacheKey, { expiresAt: Date.now() + TTL, entries }).catch(() => {});
      } catch (err) {
        context.signal?.throwIfAborted();
        if (err instanceof SubtitleHostPermission) throw err;
      }
    }

    const currentLogNo = extractLogNo(effectiveResource.url) ?? extractLogNo(resource.url);
    const allowed = context.candidate.fileEpisodes ?? [normalizeEpisode(context.candidate.episode)];
    const matching = entries.filter((entry) => {
      const entryLogNo = extractLogNo(entry.url);
      if (currentLogNo && entryLogNo === currentLogNo) return false;
      if (!isSameSeries(entry.title, series)) return false;
      const eps = postEpisodes(entry.title);
      const hasEpisode = eps.some((ep) => allowed.includes(ep));
      const hasBatch = BATCH_KEYWORD.test(entry.title);
      return hasEpisode || hasBatch;
    });

    let previousFailure: string | undefined;
    for (const entry of matching.slice(0, 4)) {
      context.signal?.throwIfAborted();
      try {
        const targetResource = await context.load(entry.url, context.signal);
        const targetEffective = await loadEffectiveResource(targetResource, context);
        const result = await resolvePageWithAttachments(targetEffective, context);
        if (result.kind === 'file') return result;
        previousFailure = result.message;
      } catch (error) {
        context.signal?.throwIfAborted();
        if (error instanceof SubtitleHostPermission) throw error;
        if (error instanceof AppError) previousFailure = error.message;
      }
    }

    return {
      ...original,
      kind: 'page',
      pageUrl: context.candidate.pageUrl ?? resource.url,
      message: matching.length
        ? (previousFailure ??
          '이전 회차 글은 찾았지만 해당 자막 파일을 읽지 못했습니다. 배포 페이지를 확인하세요.')
        : '제작자의 이전 글에서 요청 회차 자막을 찾지 못했습니다. 배포 페이지를 확인하세요.',
    };
  }
}
