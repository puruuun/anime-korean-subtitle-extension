import type {
  SubtitleLinkResolver,
  ResolverContext,
  SubtitleLinkResolution,
} from './SubtitleLinkResolver';
import type { SubtitleResource } from './resourceLoader';
import { subtitleURL, SubtitleHostPermission } from './resourceLoader';
import { GenericHtmlResolver } from './GenericHtmlResolver';
import { elementHTML } from './html';
import { plainText } from '../SubtitleParser';
import { normalizeEpisode } from '../../anime/episodeNormalizer';
import { database } from '../../storage/database';
import { AppError } from '../../utils/errors';
const TTL = 5 * 60 * 1000;
interface BlogEntry {
  title: string;
  content: string;
  url: string;
}
export function blogSeriesTitle(title: string) {
  return title
    .normalize('NFKC')
    .replace(/\s*(?:제|第)?\s*\d+(?:\.\d+)?(?:\s*[-~～〜]\s*\d+(?:\.\d+)?)?\s*(?:화|회|話).*$/, '')
    .replace(/\s*(?:자막|subtitles?)\s*$/i, '')
    .trim();
}
function postEpisodes(title: string): string[] {
  const range = title.match(/(\d+)\s*[-~～〜]\s*(\d+)\s*(?:화|회|話)/);
  if (range && Number(range[2]) >= Number(range[1]) && Number(range[2]) - Number(range[1]) <= 500)
    return Array.from({ length: Number(range[2]) - Number(range[1]) + 1 }, (_, i) =>
      String(Number(range[1]) + i),
    );
  const single = title.match(/(\d+(?:\.\d+)?)\s*(?:화|회|話)/)?.[1];
  return single ? [normalizeEpisode(single)!] : [];
}
const seriesKey = (title: string) =>
  blogSeriesTitle(title)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, '');
export class BlogspotResolver implements SubtitleLinkResolver {
  id = 'blogspot';
  async resolve(
    resource: SubtitleResource,
    context: ResolverContext,
  ): Promise<SubtitleLinkResolution | undefined> {
    const url = new URL(resource.url);
    if (!/(?:^|\.)blogspot\.com$/.test(url.hostname) || !/^\/\d{4}\/\d{2}\//.test(url.pathname))
      return undefined;
    const html = new TextDecoder().decode(resource.bytes);
    const title = plainText(elementHTML(html, 'post-title') ?? '').trim();
    const series = blogSeriesTitle(title);
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
    if (!series || !postEpisodes(title).length) return original;
    const cacheKey = JSON.stringify(['blogspot:series:v1', url.origin, series]);
    const cached = await database
      .get<{ expiresAt: number; entries: BlogEntry[] }>(cacheKey)
      .catch(() => undefined);
    context.signal?.throwIfAborted();
    let entries = cached && cached.expiresAt > Date.now() ? cached.entries : undefined;
    if (!entries) {
      entries = [];
      for (let page = 0; page < 2; page++) {
        const feedURL = new URL('/feeds/posts/default', url.origin);
        feedURL.searchParams.set('alt', 'json');
        feedURL.searchParams.set('max-results', '50');
        feedURL.searchParams.set('q', series);
        feedURL.searchParams.set('start-index', String(page * 50 + 1));
        const feed = await context.load(feedURL.href, context.signal);
        let data: {
          feed?: {
            entry?: {
              title?: { $t?: string };
              content?: { $t?: string };
              link?: { rel?: string; href?: string }[];
            }[];
            openSearch$totalResults?: { $t?: string };
          };
        };
        try {
          data = JSON.parse(new TextDecoder().decode(feed.bytes));
        } catch {
          throw new AppError(
            'BLOG_FEED',
            'Blogspot의 이전 회차 목록을 읽지 못했습니다. 배포 페이지를 확인하세요.',
          );
        }
        if (!data.feed)
          throw new AppError('BLOG_FEED', 'Blogspot의 이전 회차 목록을 읽지 못했습니다.');
        for (const entry of data.feed.entry ?? []) {
          const href = entry.link?.find((link) => link.rel === 'alternate')?.href;
          if (!href || typeof entry.title?.$t !== 'string' || typeof entry.content?.$t !== 'string')
            continue;
          try {
            const linked = new URL(subtitleURL(href));
            if (linked.hostname !== url.hostname) continue;
            linked.protocol = url.protocol;
            if (seriesKey(entry.title.$t) !== seriesKey(title)) continue;
            entries.push({ title: entry.title.$t, content: entry.content.$t, url: linked.href });
          } catch {
            /* Ignore invalid/cross-blog search results. */
          }
        }
        if ((page + 1) * 50 >= Number(data.feed['openSearch$totalResults']?.$t ?? 0)) break;
      }
      context.signal?.throwIfAborted();
      await database.put(cacheKey, { expiresAt: Date.now() + TTL, entries }).catch(() => {});
    }
    const allowed = context.candidate.fileEpisodes ?? [normalizeEpisode(context.candidate.episode)];
    const matching = entries.filter(
      (entry) =>
        postEpisodes(entry.title).some((ep) => allowed.includes(ep)) &&
        new URL(entry.url).pathname !== url.pathname,
    );
    let previousFailure: string | undefined;
    for (const entry of matching.slice(0, 4)) {
      context.signal?.throwIfAborted();
      try {
        const result = await generic.resolve(
          {
            url: entry.url,
            headers: new Headers({ 'content-type': 'text/html; charset=utf-8' }),
            bytes: new TextEncoder().encode(entry.content),
          },
          context,
        );
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
