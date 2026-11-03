import type { AnimeContext } from '../../anime/AnimeContext';
import { normalizeEpisode } from '../../anime/episodeNormalizer';
import { titleCandidates } from '../../anime/titleNormalizer';
import { request, requestJSON, publicSubtitleURL } from '../../background/network';
import { database, type Database } from '../../storage/database';
import type { SourceLanguage, SubtitleProvider, SubtitleSearchResult } from '../SubtitleProvider';
import { SubtitleLinkResolverChain } from '../../subtitle/links/SubtitleLinkResolverChain';
import { SubtitleLinkUnavailable } from '../../subtitle/links/SubtitleLinkResolver';
import { SubtitleCache } from '../../subtitle/SubtitleCache';
import { resolveKoreanTitles } from './koreanTitleResolver';
import { plainText } from '../../subtitle/SubtitleParser';
import { attribute } from '../../subtitle/links/html';
import { blogSeriesTitle, postEpisodes, seriesKey } from '../../subtitle/links/BlogspotResolver';
import { rangeEpisodes } from '../../subtitle/links/GenericHtmlResolver';

export interface WebSearchHit {
  title: string;
  url: string;
  snippet: string;
  source: 'google' | 'naver' | 'duckduckgo';
}

const EXCLUDED_DOMAINS =
  /(?:^|\.)(?:namu\.wiki|wikipedia\.org|miruro\.to|reanime\.to|youtube\.com|kin\.naver\.com|cafe\.naver\.com|search\.naver\.com|duckduckgo\.com|google\.com)$/i;

const REVIEW_PATTERN =
  /(?:리뷰|감상|줄거리|스포|명장면|해석|분석|오프닝|엔딩|가사|성우|더빙|피규어|굿즈)/i;

const SUBTITLE_INDICATOR_PATTERN = /(?:자막|smi|ass|srt|합본|첨부)/i;
const SUBTITLE_KEYWORDS = /(?:자막|\.smi|\.ass|\.srt|\.zip|합본|통합본|전편|완결)/i;

export function parseNaverSearchHtml(html: string): WebSearchHit[] {
  const hits: WebSearchHit[] = [];
  const BLOG_HOST_REGEX = /(?:^|\.)(?:tistory\.com|blogspot\.com|blog\.naver\.com)$/i;
  const matches = html.matchAll(/<a\b((?:[^>"']|"[^"]*"|'[^']*')*)>([\s\S]*?)<\/a\s*>/gi);
  const seen = new Set<string>();

  for (const m of matches) {
    const href = attribute(m[1], 'href');
    if (!href) continue;
    try {
      const parsed = new URL(href);
      if (!BLOG_HOST_REGEX.test(parsed.hostname)) continue;
      if (/^\/(?:search|tag|category|guestbook|manage|m|admin)(?:\/|$)/i.test(parsed.pathname))
        continue;
      if (seen.has(href)) continue;
      seen.add(href);

      const title = plainText(m[2]).trim();
      if (!title || title.length < 2) continue;

      const idx = html.indexOf(m[0]);
      const snippet = plainText(html.slice(idx, idx + 400)).trim();
      hits.push({ title, url: href, snippet, source: 'naver' });
    } catch {
      /* ignore invalid URLs */
    }
  }
  return hits;
}

export function parseDuckDuckGoHtml(html: string): WebSearchHit[] {
  const hits: WebSearchHit[] = [];
  const resultBlocks = html.split(/<div\b[^>]*\bclass="[^"]*\bresult\b[^"]*"[^>]*>/i).slice(1);

  if (resultBlocks.length) {
    for (const block of resultBlocks) {
      const linkMatch = block.match(
        /<a\b[^>]*\bclass="[^"]*\bresult__a\b[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i,
      );
      if (!linkMatch) continue;
      let rawUrl = linkMatch[1].replace(/&amp;/g, '&');
      const uddgMatch = rawUrl.match(/[?&]uddg=([^&]+)/);
      let url = uddgMatch ? decodeURIComponent(uddgMatch[1]) : rawUrl;
      if (url.startsWith('//')) url = 'https:' + url;

      const title = plainText(linkMatch[2]).trim();
      const snippetMatch =
        block.match(/<a\b[^>]*\bclass="[^"]*\bresult__snippet\b[^"]*"[^>]*>([\s\S]*?)<\/a>/i) ??
        block.match(/<div\b[^>]*\bclass="[^"]*\bresult__snippet\b[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
      const snippet = snippetMatch ? plainText(snippetMatch[1]).trim() : '';

      if (title && url) {
        hits.push({ title, url, snippet, source: 'duckduckgo' });
      }
    }
  } else {
    const linkMatches = html.matchAll(/<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi);
    for (const m of linkMatches) {
      let rawUrl = m[1].replace(/&amp;/g, '&');
      if (
        !rawUrl.includes('uddg=') &&
        !/(?:tistory\.com|blogspot\.com|blog\.naver\.com)/i.test(rawUrl)
      )
        continue;
      const uddgMatch = rawUrl.match(/[?&]uddg=([^&]+)/);
      let url = uddgMatch ? decodeURIComponent(uddgMatch[1]) : rawUrl;
      if (url.startsWith('//')) url = 'https:' + url;
      const title = plainText(m[2]).trim();
      if (title && url && !hits.some((h) => h.url === url)) {
        hits.push({ title, url, snippet: '', source: 'duckduckgo' });
      }
    }
  }
  return hits;
}

export function filterAndRankWebHits(
  hits: WebSearchHit[],
  enriched: AnimeContext,
  koTitles: string[] = [],
): SubtitleSearchResult[] {
  const allCandidateTitles = [...koTitles, ...titleCandidates(enriched)];
  const seenUrls = new Set<string>();

  const fileEpisodes = [
    normalizeEpisode(enriched.episode)!,
    ...(enriched.episodeOffset && enriched.episodeOffset > 0
      ? [normalizeEpisode(enriched.episode + enriched.episodeOffset)!]
      : []),
  ];

  interface ScoredHit {
    hit: WebSearchHit;
    url: string;
    parsed: URL;
    rank: number;
  }

  const scored: ScoredHit[] = [];

  for (const hit of hits) {
    let cleanUrl: string;
    let parsed: URL;
    try {
      cleanUrl = publicSubtitleURL(hit.url, true);
      parsed = new URL(cleanUrl);
    } catch {
      continue;
    }

    if (seenUrls.has(cleanUrl)) continue;
    seenUrls.add(cleanUrl);

    if (EXCLUDED_DOMAINS.test(parsed.hostname)) continue;

    if (REVIEW_PATTERN.test(hit.title) && !SUBTITLE_INDICATOR_PATTERN.test(hit.title)) {
      continue;
    }

    if (!SUBTITLE_KEYWORDS.test(hit.title + ' ' + hit.snippet)) {
      continue;
    }

    const text = (hit.title + ' ' + hit.snippet).normalize('NFKC').toLowerCase();
    const textKey = seriesKey(text);
    const matchesTitle = allCandidateTitles.some((t) => {
      const s = blogSeriesTitle(t).normalize('NFKC').toLowerCase();
      const k = seriesKey(s);
      if (k.length >= 2 && textKey.includes(k)) return true;
      const clean = s.replace(/\[[^\]]*\]|\([^)]*\)/g, '').trim();
      if (clean.length >= 2 && text.includes(clean)) return true;
      return false;
    });

    if (!matchesTitle) continue;

    const seasonMatch = hit.title.match(/(?:제?\s*(\d+)\s*기|\bseason\s*(\d+)|\bs(\d{1,2})\b)/i);
    if (seasonMatch) {
      const hitSeason = Number(seasonMatch[1] ?? seasonMatch[2] ?? seasonMatch[3]);
      if (hitSeason !== (enriched.season ?? 1)) continue;
    }

    const eps = [...postEpisodes(hit.title), ...rangeEpisodes(hit.title)];
    const isBatch = /(?:합본|통합본|전편|완결|모음|전체|batch|complete|full)/i.test(
      hit.title + ' ' + hit.snippet,
    );
    const exactEp = eps.some((ep) => fileEpisodes.includes(ep));

    let rank = 0;
    if (exactEp) {
      rank += 50;
    } else if (isBatch) {
      rank += 40;
    } else if (eps.length === 0) {
      rank += 20;
    } else {
      rank += 5;
    }
    if (hit.source === 'google') rank += 15;
    if (/(?:^|\.)(?:tistory\.com|blog\.naver\.com|blogspot\.com)$/i.test(parsed.hostname))
      rank += 20;

    scored.push({ hit, url: cleanUrl, parsed, rank });
  }

  scored.sort((a, b) => b.rank - a.rank);

  return scored.map((item, index) => ({
    id: `web-ko:${index}:${item.url}`,
    providerId: 'web-ko',
    title: enriched.title,
    matchedTitle: enriched.title,
    anilistId: enriched.anilistId,
    season: enriched.season,
    year: enriched.year,
    episode: normalizeEpisode(enriched.episode) ?? String(enriched.episode),
    fileEpisodes,
    requireEpisodeMatch: true,
    language: 'ko' as const,
    author: item.parsed.hostname,
    release: item.hit.title,
    pageUrl: item.url,
    updatedAt: String(item.rank).padStart(5, '0'),
  }));
}

export class WebKoreanSubtitleProvider implements SubtitleProvider {
  id = 'web-ko';

  constructor(
    private googleSearch: { apiKey: string; cx: string } = { apiKey: '', cx: '' },
    private defaultSignal?: AbortSignal,
    private links = new SubtitleLinkResolverChain(),
    private cache = new SubtitleCache(),
    private db: Pick<Database, 'get' | 'put'> = database,
  ) {}

  async search(
    c: AnimeContext,
    language: SourceLanguage,
    signal = this.defaultSignal,
  ): Promise<SubtitleSearchResult[]> {
    if (language !== 'ko') return [];
    signal?.throwIfAborted();

    const koTitles = await resolveKoreanTitles(c, signal, this.db);
    const enriched: AnimeContext = {
      ...c,
      synonyms: [...new Set([...(c.synonyms ?? []), ...koTitles])],
      titles: {
        ...c.titles,
        synonyms: [...new Set([...(c.titles?.synonyms ?? []), ...koTitles])],
      },
    };

    const queryTitle = koTitles[0] ?? c.title;
    const epStr = normalizeEpisode(c.episode) ?? String(c.episode);
    const queries = [`${queryTitle} ${epStr}화 자막`, `${queryTitle} 자막 합본`];

    const hits: WebSearchHit[] = [];

    for (const q of queries) {
      signal?.throwIfAborted();

      // 1. Google Custom Search JSON API
      if (this.googleSearch.apiKey.trim() && this.googleSearch.cx.trim()) {
        try {
          const googleUrl = `https://customsearch.googleapis.com/customsearch/v1?key=${encodeURIComponent(
            this.googleSearch.apiKey.trim(),
          )}&cx=${encodeURIComponent(this.googleSearch.cx.trim())}&q=${encodeURIComponent(
            q,
          )}&num=10`;
          const data = await requestJSON<{
            items?: { title?: string; link?: string; snippet?: string }[];
          }>(googleUrl, {}, 6000, signal);
          for (const item of data.items ?? []) {
            if (item.link && item.title) {
              hits.push({
                title: item.title,
                url: item.link,
                snippet: item.snippet ?? '',
                source: 'google',
              });
            }
          }
        } catch (e) {
          if (signal?.aborted) throw signal.reason;
        }
      }

      // 2. Naver Search
      try {
        signal?.throwIfAborted();
        const naverUrl = `https://search.naver.com/search.naver?where=nexearch&query=${encodeURIComponent(
          q,
        )}`;
        const bytes = await request(naverUrl, {}, 6000, signal);
        const html = new TextDecoder().decode(bytes);
        hits.push(...parseNaverSearchHtml(html));
      } catch (e) {
        if (signal?.aborted) throw signal.reason;
      }

      // 3. DuckDuckGo Search
      try {
        signal?.throwIfAborted();
        const ddgUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(
          q + ' (site:tistory.com OR site:blogspot.com OR site:blog.naver.com)',
        )}`;
        const bytes = await request(ddgUrl, {}, 6000, signal);
        const html = new TextDecoder().decode(bytes);
        hits.push(...parseDuckDuckGoHtml(html));
      } catch (e) {
        if (signal?.aborted) throw signal.reason;
      }
    }

    return filterAndRankWebHits(hits, enriched, koTitles);
  }

  async download(
    candidate: SubtitleSearchResult,
    signal = this.defaultSignal,
  ): Promise<ArrayBuffer> {
    const cached = await this.cache.get(candidate.id);
    if (cached) return cached;
    signal?.throwIfAborted();
    const r = await this.links.resolve(candidate, signal);
    if (r.kind !== 'file') throw new SubtitleLinkUnavailable(r);
    await this.cache.put(candidate.id, r.buffer);
    return r.buffer;
  }
}
