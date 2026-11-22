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

function collectTistoryPosts(
  html: string,
  origin: string,
  hostname: string,
  postMap: Map<string, TistoryPostEntry>,
) {
  for (const l of htmlLinks(html, origin)) {
    try {
      const u = new URL(l.url);
      if (u.hostname !== hostname) continue;
      if (
        /^\/(?:search|tag|category|guestbook|manage|m|admin|toolbar|notice|attachment|dn|archive)(?:\/|$)/i.test(
          u.pathname,
        )
      )
        continue;
      if (u.pathname === '/' || !u.pathname) continue;
      const cleanUrl = u.origin + u.pathname;
      const titleText = l.label
        .replace(/\s*\d{4}[.\-/]\d{2}[.\-/]\d{2}(?:\s+\d{2}:\d{2})?\s*$/, '')
        .replace(/\s+/g, ' ')
        .trim();
      if (!titleText || titleText.length < 2) continue;
      const existing = postMap.get(cleanUrl);
      if (!existing) {
        postMap.set(cleanUrl, { title: titleText, url: cleanUrl });
      } else {
        // Prefer concise post titles over long search-card body excerpts.
        const existingConcise = existing.title.length <= 120;
        const nextConcise = titleText.length <= 120;
        if (
          (!existingConcise && nextConcise) ||
          (existingConcise === nextConcise &&
            postEpisodes(titleText).length > 0 &&
            postEpisodes(existing.title).length === 0)
        ) {
          postMap.set(cleanUrl, { title: titleText, url: cleanUrl });
        }
      }
    } catch {
      /* ignore invalid URLs */
    }
  }
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

    const cacheKey = JSON.stringify(['tistory:series:v2', url.origin, series]);
    const cached = await database
      .get<{ expiresAt: number; entries: TistoryPostEntry[] }>(cacheKey)
      .catch(() => undefined);
    context.signal?.throwIfAborted();

    let entries = cached && cached.expiresAt > Date.now() ? cached.entries : undefined;

    if (!entries) {
      const postMap = new Map<string, TistoryPostEntry>();
      collectTistoryPosts(html, url.origin, url.hostname, postMap);
      const searchUrl = `${url.origin}/search/${encodeURIComponent(series)}`;
      try {
        const searchResource = await context.load(searchUrl, context.signal);
        const searchHtml = new TextDecoder().decode(searchResource.bytes);
        collectTistoryPosts(searchHtml, url.origin, url.hostname, postMap);
      } catch (err) {
        context.signal?.throwIfAborted();
        if (err instanceof SubtitleHostPermission) throw err;
      }
      entries = Array.from(postMap.values());
      context.signal?.throwIfAborted();
      await database.put(cacheKey, { expiresAt: Date.now() + TTL, entries }).catch(() => {});
    }

    const allowed = context.candidate.fileEpisodes ?? [normalizeEpisode(context.candidate.episode)];
    const filterMatching = (list: TistoryPostEntry[]) =>
      list.filter((entry) => {
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

    let matching = filterMatching(entries);

    if (!matching.length) {
      const categoryLinks = htmlLinks(html, url.origin)
        .filter((l) => {
          try {
            const u = new URL(l.url);
            return (
              u.hostname === url.hostname &&
              /^\/category\/.+/i.test(u.pathname) &&
              isSameSeries(decodeURIComponent(u.pathname.replace(/^\/category\//i, '')), series)
            );
          } catch {
            return false;
          }
        })
        .slice(0, 2);
      if (categoryLinks.length) {
        const postMap = new Map<string, TistoryPostEntry>(entries.map((e) => [e.url, e]));
        for (const cat of categoryLinks) {
          context.signal?.throwIfAborted();
          try {
            const catRes = await context.load(cat.url, context.signal);
            const catHtml = new TextDecoder().decode(catRes.bytes);
            collectTistoryPosts(catHtml, url.origin, url.hostname, postMap);
          } catch (err) {
            context.signal?.throwIfAborted();
            if (err instanceof SubtitleHostPermission) throw err;
          }
        }
        entries = Array.from(postMap.values());
        matching = filterMatching(entries);
      }
    }

    let previousFailure: string | undefined;
    for (const entry of matching.slice(0, 4)) {
      context.signal?.throwIfAborted();
      try {
        const entryResource = await context.load(entry.url, context.signal);
        const entryHtml = new TextDecoder().decode(entryResource.bytes);
        const entryTitle = extractTistoryTitle(entryHtml) || entry.title;
        const entryEps = postEpisodes(entryTitle);
        const exactSingleEpisodePost =
          entryEps.length === 1 &&
          allowed.includes(entryEps[0]) &&
          !BATCH_KEYWORD.test(entryTitle);
        const entryContext: ResolverContext = exactSingleEpisodePost
          ? {
              ...context,
              candidate: { ...context.candidate, requireEpisodeMatch: false },
            }
          : context;
        const result = await generic.resolve(entryResource, entryContext);
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
