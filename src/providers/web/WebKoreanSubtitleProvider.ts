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
  date?: string;
  source: 'google' | 'naver' | 'duckduckgo';
}

export interface WebManualSearchResult {
  id: string;
  title: string;
  url: string;
  host: string;
  snippet: string;
  date?: string;
  source: 'google' | 'naver' | 'duckduckgo';
  subtitleLikely: boolean;
}

const EXCLUDED_DOMAINS =
  /(?:^|\.)(?:namu\.wiki|wikipedia\.org|miruro\.to|reanime\.(?:to|cz)|youtube\.com|youtu\.be|kin\.naver\.com|cafe\.naver\.com|search\.naver\.com|nid\.naver\.com|help\.naver\.com|mkt\.naver\.com|shopping\.naver\.com|news\.naver\.com|comic\.naver\.com|series\.naver\.com|pstatic\.net|duckduckgo\.com|google\.com|google\.co\.kr|daum\.net|kakao\.com|instagram\.com|facebook\.com|x\.com|twitter\.com|tiktok\.com|netflix\.com|laftel\.net|watcha\.com|wavve\.com|tving\.com|coupang\.com|yes24\.com|aladin\.co\.kr|kyobobook\.co\.kr)$/i;

const AUTO_SUBTITLE_HOST_REGEX =
  /(?:^|\.)(?:tistory\.com|blogspot\.com|blog\.naver\.com|postype\.com|drive\.google\.com|github\.com|raw\.githubusercontent\.com)$/i;

const DIRECT_SUBTITLE_PATH_REGEX = /\.(?:srt|ass|ssa|smi|sami|vtt|zip)(?:$|[?#])/i;

const REVIEW_PATTERN =
  /(?:리뷰|\breview\b|감상|줄거리|스포|명장면|해석|분석|오프닝|엔딩|가사|성우|더빙|피규어|굿즈)/i;

const ANTI_SUBTITLE_PATTERN =
  /(?:자막\s*(?:질문|요청|공유|배포|파일).{0,16}(?:받지\s*않|하지\s*않|없습니다|안\s*합니다|불가))/i;

const SUBTITLE_INDICATOR_PATTERN = /(?:자막|smi|ass|srt|vtt|합본|첨부|subtitle)/i;
const SUBTITLE_KEYWORDS = /(?:자막|\.smi|\.ass|\.srt|\.vtt|\.zip|합본|통합본|전편|완결|subtitle)/i;

const NAVER_DATE_REGEX = /^(\d{4}\.\d{2}\.\d{2})\.?$/;
const NAVER_BREADCRUMB_REGEX = /^[\w.-]+\.(?:com|net|kr|org|io|me|jp|tv|cc|cz)(?:\s*[›>\/].*)?$/i;

function cleanNaverAnchorText(raw: string): string {
  return plainText(raw)
    .replace(/\s*(?:새\s*창\s*열림|새로운\s*창으로\s*열림)\s*$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function isBlogProfileRoot(parsed: URL): boolean {
  const parts = parsed.pathname.split('/').filter(Boolean);
  if (/(?:^|\.)blog\.naver\.com$/i.test(parsed.hostname)) {
    return parts.length < 2 && !parsed.searchParams.get('logNo');
  }
  if (/(?:^|\.)(?:tistory\.com|blogspot\.com)$/i.test(parsed.hostname)) {
    return parts.length === 0;
  }
  return false;
}

export function parseNaverSearchHtml(
  html: string,
  options: { allowAnyPublicHost?: boolean } = {},
): WebSearchHit[] {
  const allowAnyPublicHost = options.allowAnyPublicHost === true;
  const matches = html.matchAll(/<a\b((?:[^>"']|"[^"]*"|'[^']*')*)>([\s\S]*?)<\/a\s*>/gi);
  const grouped = new Map<
    string,
    { url: string; texts: string[]; date?: string; firstIndex: number }
  >();

  for (const m of matches) {
    const href = attribute(m[1], 'href');
    if (!href) continue;
    let parsed: URL;
    let cleanUrl: string;
    try {
      cleanUrl = publicSubtitleURL(href, true);
      parsed = new URL(cleanUrl);
    } catch {
      continue;
    }
    if (EXCLUDED_DOMAINS.test(parsed.hostname)) continue;
    if (
      !allowAnyPublicHost &&
      !AUTO_SUBTITLE_HOST_REGEX.test(parsed.hostname) &&
      !DIRECT_SUBTITLE_PATH_REGEX.test(parsed.pathname)
    ) {
      continue;
    }
    if (/^\/(?:search|tag|category|guestbook|manage|m|admin)(?:\/|$)/i.test(parsed.pathname))
      continue;
    if (isBlogProfileRoot(parsed)) continue;

    let entry = grouped.get(cleanUrl);
    if (!entry) {
      entry = { url: cleanUrl, texts: [], firstIndex: m.index ?? 0 };
      grouped.set(cleanUrl, entry);
    }

    const cleaned = cleanNaverAnchorText(m[2]);
    if (!cleaned) continue;

    const dateMatch = cleaned.match(NAVER_DATE_REGEX);
    if (dateMatch) {
      entry.date ??= dateMatch[1];
      continue;
    }
    if (NAVER_BREADCRUMB_REGEX.test(cleaned)) continue;
    if (cleaned.length < 2) continue;
    if (!entry.texts.includes(cleaned)) entry.texts.push(cleaned);
  }

  const hits: WebSearchHit[] = [];
  for (const entry of grouped.values()) {
    if (!entry.texts.length) continue;
    // Naver cards emit the post title anchor before the body snippet anchor.
    const titleIndex = entry.texts.findIndex(
      (t) => t.length >= 3 && t.length <= 140 && !/^related posts?:?$/i.test(t),
    );
    const chosenIndex = titleIndex >= 0 ? titleIndex : 0;
    const title = entry.texts[chosenIndex];
    const extraTexts = entry.texts.filter((_t, i) => i !== chosenIndex);
    const snippet = extraTexts.length
      ? extraTexts.join(' ').slice(0, 400).trim()
      : plainText(html.slice(entry.firstIndex, entry.firstIndex + 400)).trim();
    hits.push({
      title,
      url: entry.url,
      snippet,
      ...(entry.date ? { date: entry.date } : {}),
      source: 'naver',
    });
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

    if (ANTI_SUBTITLE_PATTERN.test(hit.title + ' ' + hit.snippet)) {
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
    const expectedSeason = enriched.season ?? 1;
    let exactSeason = false;
    if (seasonMatch) {
      const hitSeason = Number(seasonMatch[1] ?? seasonMatch[2] ?? seasonMatch[3]);
      if (hitSeason !== expectedSeason) continue;
      exactSeason = true;
    } else if (expectedSeason > 1 && enriched.year && hit.date) {
      const hitYear = Number(hit.date.slice(0, 4));
      if (Number.isFinite(hitYear) && hitYear > 0 && hitYear < enriched.year) {
        continue;
      }
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
    if (exactSeason && expectedSeason > 1) rank += 25;
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

export function rankManualWebHits(hits: WebSearchHit[], limit = 12): WebManualSearchResult[] {
  const seenUrls = new Set<string>();
  const scored: { result: WebManualSearchResult; rank: number }[] = [];

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
    if (isBlogProfileRoot(parsed)) continue;

    const combined = `${hit.title} ${hit.snippet}`;
    const hasAntiSubtitle = ANTI_SUBTITLE_PATTERN.test(combined);
    const hasReviewOnly =
      REVIEW_PATTERN.test(hit.title) && !SUBTITLE_INDICATOR_PATTERN.test(hit.title);
    const directFile = DIRECT_SUBTITLE_PATH_REGEX.test(parsed.pathname);
    const subtitleLikely =
      !hasAntiSubtitle &&
      (directFile ||
        /(?:^|\.)drive\.google\.com$/i.test(parsed.hostname) ||
        SUBTITLE_INDICATOR_PATTERN.test(hit.title) ||
        (SUBTITLE_KEYWORDS.test(combined) && !hasReviewOnly));

    let rank = 0;
    if (directFile) rank += 60;
    if (SUBTITLE_INDICATOR_PATTERN.test(hit.title)) rank += 45;
    else if (SUBTITLE_KEYWORDS.test(combined)) rank += 20;
    if (AUTO_SUBTITLE_HOST_REGEX.test(parsed.hostname)) rank += 20;
    if (hit.source === 'google') rank += 15;
    if (hasReviewOnly) rank -= 30;
    if (hasAntiSubtitle) rank -= 50;

    scored.push({
      rank,
      result: {
        id: `web-manual:${scored.length}:${cleanUrl}`,
        title: hit.title,
        url: cleanUrl,
        host: parsed.hostname,
        snippet: hit.snippet.slice(0, 220),
        ...(hit.date ? { date: hit.date } : {}),
        source: hit.source,
        subtitleLikely,
      },
    });
  }

  scored.sort((a, b) => b.rank - a.rank);
  return scored.slice(0, limit).map((item) => item.result);
}

export async function suggestWebSearchQuery(
  c: AnimeContext,
  signal?: AbortSignal,
  db: Pick<Database, 'get' | 'put'> = database,
): Promise<string> {
  if (c.site === 'generic') {
    const base = c.title.trim();
    return base ? `${base} 자막` : '';
  }
  const koTitles = await resolveKoreanTitles(c, signal, db);
  const queryTitle = (koTitles[0] ?? c.title ?? '').trim();
  if (!queryTitle) return '';
  const epStr = c.episode > 0 ? normalizeEpisode(c.episode) ?? String(c.episode) : '';
  return epStr ? `${queryTitle} ${epStr}화 자막` : `${queryTitle} 자막`;
}

export function buildManualWebCandidate(
  url: string,
  context: AnimeContext,
  title?: string,
): SubtitleSearchResult {
  const cleanUrl = publicSubtitleURL(url, true);
  const parsed = new URL(cleanUrl);
  const ep =
    context.site !== 'generic' && context.episode > 0
      ? normalizeEpisode(context.episode) ?? String(context.episode)
      : undefined;
  const fileEpisodes = ep
    ? [
        ep,
        ...(context.episodeOffset && context.episodeOffset > 0
          ? [normalizeEpisode(context.episode + context.episodeOffset)!]
          : []),
      ]
    : undefined;
  return {
    id: `web-manual:${cleanUrl}`,
    providerId: 'web-ko',
    title: context.title || title || parsed.hostname,
    matchedTitle: context.title || title || parsed.hostname,
    anilistId: context.anilistId,
    season: context.season,
    year: context.year,
    episode: ep,
    fileEpisodes,
    requireEpisodeMatch: false,
    language: 'ko',
    author: parsed.hostname,
    release: title?.trim() || parsed.hostname,
    pageUrl: cleanUrl,
  };
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

  private async fetchWebHits(
    q: string,
    options: { allowAnyPublicHost?: boolean } = {},
    signal = this.defaultSignal,
  ): Promise<WebSearchHit[]> {
    signal?.throwIfAborted();
    const tasks: Promise<WebSearchHit[]>[] = [];

    // 1. Google Custom Search JSON API
    if (this.googleSearch.apiKey.trim() && this.googleSearch.cx.trim()) {
      tasks.push(
        (async () => {
          const googleUrl = `https://customsearch.googleapis.com/customsearch/v1?key=${encodeURIComponent(
            this.googleSearch.apiKey.trim(),
          )}&cx=${encodeURIComponent(this.googleSearch.cx.trim())}&q=${encodeURIComponent(
            q,
          )}&num=10`;
          const data = await requestJSON<{
            items?: { title?: string; link?: string; snippet?: string }[];
          }>(googleUrl, {}, 6000, signal);
          const out: WebSearchHit[] = [];
          for (const item of data.items ?? []) {
            if (item.link && item.title) {
              out.push({
                title: item.title,
                url: item.link,
                snippet: item.snippet ?? '',
                source: 'google',
              });
            }
          }
          return out;
        })(),
      );
    }

    // 2. Naver Search
    tasks.push(
      (async () => {
        const naverUrl = `https://search.naver.com/search.naver?where=nexearch&query=${encodeURIComponent(
          q,
        )}`;
        const bytes = await request(naverUrl, {}, 6000, signal);
        const html = new TextDecoder().decode(bytes);
        return parseNaverSearchHtml(html, options);
      })(),
    );

    // 3. DuckDuckGo Search
    tasks.push(
      (async () => {
        const ddgQuery = options.allowAnyPublicHost
          ? q
          : q + ' (site:tistory.com OR site:blogspot.com OR site:blog.naver.com)';
        const ddgUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(ddgQuery)}`;
        const bytes = await request(ddgUrl, {}, 6000, signal);
        const html = new TextDecoder().decode(bytes);
        return parseDuckDuckGoHtml(html);
      })(),
    );

    const settled = await Promise.allSettled(tasks);
    signal?.throwIfAborted();
    const hits: WebSearchHit[] = [];
    for (const res of settled) {
      if (res.status === 'fulfilled') hits.push(...res.value);
    }
    return hits;
  }

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
      hits.push(...(await this.fetchWebHits(q, { allowAnyPublicHost: false }, signal)));
    }

    return filterAndRankWebHits(hits, enriched, koTitles);
  }

  async searchManual(
    query: string,
    signal = this.defaultSignal,
    limit = 12,
  ): Promise<WebManualSearchResult[]> {
    const trimmed = query.trim();
    if (!trimmed) return [];
    const hits = await this.fetchWebHits(trimmed, { allowAnyPublicHost: true }, signal);
    return rankManualWebHits(hits, limit);
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
