import type {
  SubtitleLinkResolver,
  ResolverContext,
  SubtitleLinkResolution,
} from './SubtitleLinkResolver';
import type { SubtitleResource } from './resourceLoader';
import { SubtitleHostPermission } from './resourceLoader';
import { GenericHtmlResolver } from './GenericHtmlResolver';
import { htmlLinks, elementHTML } from './html';
import { plainText } from '../SubtitleParser';
import { normalizeEpisode } from '../../anime/episodeNormalizer';
import { database } from '../../storage/database';
import { AppError } from '../../utils/errors';
import { blogSeriesTitle, postEpisodes, seriesKey } from './BlogspotResolver';

const TTL = 5 * 60 * 1000;
const BATCH_KEYWORD = /(?:합본|통합본|전편|완결|모음|전체|batch|complete|full)/i;

interface TistoryPostEntry {
  title: string;
  url: string;
}

function extractTistoryTitle(html: string): string {
  const ogTitle =
    html.match(
      /<meta\b[^>]*property\s*=\s*["']og:title["'][^>]*content\s*=\s*["']([^"']+)["']/i,
    )?.[1] ??
    html.match(
      /<meta\b[^>]*content\s*=\s*["']([^"']+)["'][^>]*property\s*=\s*["']og:title["']/i,
    )?.[1];
  if (ogTitle) return plainText(ogTitle).trim();

  const postTitle =
    elementHTML(html, 'post-title') ??
    elementHTML(html, 'title-article') ??
    elementHTML(html, 'tit_post') ??
    elementHTML(html, 'title_post');
  if (postTitle) return plainText(postTitle).trim();

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

export class TistoryResolver implements SubtitleLinkResolver {
  id = 'tistory';

  async resolve(
    resource: SubtitleResource,
    context: ResolverContext,
  ): Promise<SubtitleLinkResolution | undefined> {
    const url = new URL(resource.url);
    if (!/(?:^|\.)tistory\.com$/i.test(url.hostname)) return undefined;

    const generic = new GenericHtmlResolver();
    let original: SubtitleLinkResolution;
    try {
      original = await generic.resolve(resource, context);
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

    const html = new TextDecoder().decode(resource.bytes);
    const postTitle = extractTistoryTitle(html);
    let series = blogSeriesTitle(postTitle);
    if (!series) {
      series = blogSeriesTitle(context.candidate.matchedTitle ?? context.candidate.title);
    }
    if (!series) return original;

    const cacheKey = JSON.stringify(['tistory:series:v1', url.origin, series]);
    const cached = await database
      .get<{ expiresAt: number; entries: TistoryPostEntry[] }>(cacheKey)
      .catch(() => undefined);
    context.signal?.throwIfAborted();

    let entries = cached && cached.expiresAt > Date.now() ? cached.entries : undefined;

    if (!entries) {
      entries = [];
      const searchUrl = `${url.origin}/search/${encodeURIComponent(series)}`;
      try {
        const searchResource = await context.load(searchUrl, context.signal);
        const searchHtml = new TextDecoder().decode(searchResource.bytes);
        const links = htmlLinks(searchHtml, url.origin);
        const postMap = new Map<string, TistoryPostEntry>();

        for (const l of links) {
          try {
            const u = new URL(l.url);
            if (u.hostname !== url.hostname) continue;
            if (
              /^\/(?:search|tag|category|guestbook|manage|m|admin|toolbar|notice|attachment|dn)(?:\/|$)/i.test(
                u.pathname,
              )
            )
              continue;
            if (u.pathname === '/' || !u.pathname) continue;
            const cleanUrl = u.origin + u.pathname;
            const titleText = l.label.trim();
            if (!titleText) continue;
            const existing = postMap.get(cleanUrl);
            if (!existing || titleText.length > existing.title.length) {
              postMap.set(cleanUrl, { title: titleText, url: cleanUrl });
            }
          } catch {
            /* ignore invalid URLs */
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

    const allowed = context.candidate.fileEpisodes ?? [normalizeEpisode(context.candidate.episode)];
    const matching = entries.filter((entry) => {
      try {
        if (new URL(entry.url).pathname === url.pathname) return false;
      } catch {
        return false;
      }
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
        const entryResource = await context.load(entry.url, context.signal);
        const result = await generic.resolve(entryResource, context);
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
