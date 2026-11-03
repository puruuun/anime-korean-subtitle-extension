import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { strToU8, zipSync } from 'fflate';
import type { AnimeContext } from '../src/anime/AnimeContext';
import { database } from '../src/storage/database';
import { defaultSettings } from '../src/storage/settings';
import { resolveKoreanTitles } from '../src/providers/web/koreanTitleResolver';
import {
  WebKoreanSubtitleProvider,
  parseNaverSearchHtml,
  parseDuckDuckGoHtml,
  filterAndRankWebHits,
  type WebSearchHit,
} from '../src/providers/web/WebKoreanSubtitleProvider';
import { AnissiaProvider } from '../src/providers/anissia/AnissiaProvider';
import { SubtitlePipeline } from '../src/subtitle/SubtitlePipeline';
import type { SubtitleResource } from '../src/subtitle/links/resourceLoader';
import { SubtitleLinkResolverChain } from '../src/subtitle/links/SubtitleLinkResolverChain';

const animeContext: AnimeContext = {
  site: 'miruro',
  title: 'Sousou no Frieren',
  englishTitle: 'Frieren: Beyond Journey’s End',
  nativeTitle: '葬送のフリーレン',
  episode: 1,
  season: 1,
  anilistId: 154587,
  malId: 52991,
  pageUrl: 'https://miruro.to/watch/154587',
};

const srtBody = '1\n00:00:01,000 --> 00:00:04,000\n인간의 수명은 짧아.';
const resource = (
  url: string,
  body: string,
  headers: Record<string, string> = {},
): SubtitleResource => ({
  url,
  bytes: strToU8(body),
  headers: new Headers(headers),
});

beforeEach(async () => {
  await database.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Wikidata Korean Title Resolution', () => {
  it('returns existing Korean title without fetching Wikidata if Hangul is already in AnimeContext', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const contextWithKo: AnimeContext = {
      ...animeContext,
      koreanTitle: '장송의 프리렌',
    };

    const titles = await resolveKoreanTitles(contextWithKo);
    expect(titles).toContain('장송의 프리렌');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('queries Wikidata, matches AniList ID, extracts Korean labels/aliases, expands season 2+, and caches', async () => {
    const searchResponse = {
      search: [{ id: 'Q108841443' }],
    };

    const entitiesResponse = {
      entities: {
        Q108841443: {
          id: 'Q108841443',
          labels: {
            ko: { language: 'ko', value: '장송의 프리렌' },
            ja: { language: 'ja', value: '葬送のフリーレン' },
            en: { language: 'en', value: 'Frieren: Beyond Journey’s End' },
          },
          aliases: {
            ko: [{ language: 'ko', value: '프리렌' }],
          },
          claims: {
            P8729: [
              {
                mainsnak: {
                  datavalue: { value: '154587', type: 'string' },
                },
              },
            ],
            P4086: [
              {
                mainsnak: {
                  datavalue: { value: '52991', type: 'string' },
                },
              },
            ],
          },
        },
      },
    };

    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('wbsearchentities')) {
        return new Response(JSON.stringify(searchResponse));
      }
      if (url.includes('wbgetentities')) {
        return new Response(JSON.stringify(entitiesResponse));
      }
      return new Response('{}', { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const season2Context: AnimeContext = {
      ...animeContext,
      season: 2,
    };

    const titles = await resolveKoreanTitles(season2Context);
    expect(titles).toContain('장송의 프리렌 2기');
    expect(titles).toContain('장송의 프리렌');
    expect(titles).toContain('프리렌 2기');
    expect(titles).toContain('프리렌');

    // Second call should hit IndexedDB cache and make no new fetch calls
    const cached = await resolveKoreanTitles(season2Context);
    expect(cached).toEqual(titles);
    expect(fetchMock).toHaveBeenCalledTimes(2); // 1 search + 1 get
  });
});

describe('WebKoreanSubtitleProvider HTML parsers and hit ranking', () => {
  it('parses Naver Search HTML extracting valid blog links and snippets', () => {
    const html = `
      <div class="main_pack">
        <div class="api_subject_bx">
          <a href="https://example.tistory.com/105" class="title_link">장송의 프리렌 1화 자막 [SMI]</a>
          <a href="https://search.naver.com/search.naver?where=nexearch">네이버 검색</a>
          <a href="https://blog.naver.com/testauthor/220000000001" class="title_link">장송의 프리렌 1화 자막 다운로드</a>
          <a href="https://namu.wiki/w/장송의_프리렌">나무위키</a>
        </div>
      </div>
    `;

    const hits = parseNaverSearchHtml(html);
    expect(hits).toHaveLength(2);
    expect(hits[0]).toMatchObject({
      title: '장송의 프리렌 1화 자막 [SMI]',
      url: 'https://example.tistory.com/105',
      source: 'naver',
    });
    expect(hits[1]).toMatchObject({
      title: '장송의 프리렌 1화 자막 다운로드',
      url: 'https://blog.naver.com/testauthor/220000000001',
      source: 'naver',
    });
  });

  it('parses DuckDuckGo HTML and decodes uddg redirects and snippets', () => {
    const html = `
      <div class="result results_links">
        <a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fauthor.blogspot.com%2F2023%2F10%2F01.html&amp;rut=1">
          장송의 프리렌 1화 자막 (완결)
        </a>
        <div class="result__snippet">
          장송의 프리렌 1화 자막 및 합본 자막 안내입니다.
        </div>
      </div>
      <div class="result results_links">
        <a class="result__a" href="https://example.tistory.com/50">
          장송의 프리렌 1-28화 통합본 자막
        </a>
        <div class="result__snippet">
          장송의 프리렌 전편 통합본 자막 zip 파일 다운로드
        </div>
      </div>
    `;

    const hits = parseDuckDuckGoHtml(html);
    expect(hits).toHaveLength(2);
    expect(hits[0]).toMatchObject({
      title: '장송의 프리렌 1화 자막 (완결)',
      url: 'https://author.blogspot.com/2023/10/01.html',
      source: 'duckduckgo',
    });
    expect(hits[1]).toMatchObject({
      title: '장송의 프리렌 1-28화 통합본 자막',
      url: 'https://example.tistory.com/50',
      source: 'duckduckgo',
    });
  });

  it('filters out reviews without subtitles and ranks exact episodes over batches', () => {
    const hits: WebSearchHit[] = [
      {
        title: '장송의 프리렌 1화 리뷰 및 감상평 줄거리',
        url: 'https://review.tistory.com/1',
        snippet: '1화 줄거리와 감상입니다.',
        source: 'naver',
      },
      {
        title: '장송의 프리렌 1화 자막 다운로드',
        url: 'https://sub.tistory.com/1',
        snippet: '장송의 프리렌 1화 자막 파일입니다.',
        source: 'naver',
      },
      {
        title: '장송의 프리렌 전편 완결 합본 자막',
        url: 'https://batch.tistory.com/10',
        snippet: '장송의 프리렌 1-28화 통합본 자막.zip',
        source: 'naver',
      },
    ];

    const results = filterAndRankWebHits(hits, animeContext, ['장송의 프리렌']);
    expect(results).toHaveLength(2);
    // Review post was filtered out
    expect(results.some((r) => r.pageUrl === 'https://review.tistory.com/1')).toBe(false);

    // Exact episode 1 post should rank higher than batch
    expect(results[0].pageUrl).toBe('https://sub.tistory.com/1');
    expect(results[0].release).toBe('장송의 프리렌 1화 자막 다운로드');
    expect(results[1].pageUrl).toBe('https://batch.tistory.com/10');
  });
});

describe('WebKoreanSubtitleProvider Search & Download', () => {
  it('calls Google Custom Search JSON API when configured, and resolves downloaded file', async () => {
    const zipBytes = zipSync({
      'Sousou no Frieren 01.srt': strToU8(srtBody),
    });

    const googleResponse = {
      items: [
        {
          title: '장송의 프리렌 1화 자막',
          link: 'https://subauthor.tistory.com/123',
          snippet: '장송의 프리렌 1화 자막 첨부파일',
        },
      ],
    };

    const tistoryHtml = `
      <div class="title-article">장송의 프리렌 1화 자막</div>
      <div class="contents_style">
        <a href="https://blog.kakaocdn.net/dn/xyz/frieren_01.zip?attach=1">자막 다운로드</a>
      </div>
    `;

    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('customsearch.googleapis.com')) {
        return new Response(JSON.stringify(googleResponse));
      }
      if (url.includes('search.naver.com') || url.includes('duckduckgo.com')) {
        return new Response('<html></html>');
      }
      if (url === 'https://subauthor.tistory.com/123') {
        return new Response(tistoryHtml, {
          headers: { 'content-type': 'text/html; charset=utf-8' },
        });
      }
      if (url.includes('blog.kakaocdn.net')) {
        return new Response(zipBytes, { headers: { 'content-type': 'application/zip' } });
      }
      return new Response('not found', { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const provider = new WebKoreanSubtitleProvider(
      { apiKey: 'test-google-key', cx: 'test-cx' },
      undefined,
      new SubtitleLinkResolverChain(undefined, async (url) =>
        resource(url, url.includes('blog.kakaocdn.net') ? '' : tistoryHtml),
      ),
    );

    // Context with Korean title so no Wikidata fetch needed
    const context: AnimeContext = {
      ...animeContext,
      koreanTitle: '장송의 프리렌',
    };

    // Override resolver chain loader with actual mock
    const customProvider = new WebKoreanSubtitleProvider(
      { apiKey: 'test-google-key', cx: 'test-cx' },
      undefined,
      new SubtitleLinkResolverChain(undefined, async (url) => {
        if (url === 'https://subauthor.tistory.com/123') {
          return resource(url, tistoryHtml, { 'content-type': 'text/html' });
        }
        if (url.includes('blog.kakaocdn.net')) {
          return {
            url,
            bytes: zipBytes,
            headers: new Headers({ 'content-type': 'application/zip' }),
          };
        }
        return resource(url, '');
      }),
    );

    const results = await customProvider.search(context, 'ko');
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].pageUrl).toBe('https://subauthor.tistory.com/123');

    const downloaded = await customProvider.download(results[0]);
    expect(downloaded.byteLength).toBe(zipBytes.byteLength);
  });
});

describe('SubtitlePipeline Anissia fallback to WebKoreanSubtitleProvider', () => {
  it('falls back to webFallback when Anissia returns empty, returning web-ko source without AI translation', async () => {
    const webCandidate = {
      id: 'web-ko:0:https://blog.naver.com/testauthor/100',
      providerId: 'web-ko',
      title: animeContext.title,
      matchedTitle: animeContext.title,
      anilistId: animeContext.anilistId,
      season: animeContext.season,
      year: animeContext.year,
      episode: '1',
      fileEpisodes: ['1'],
      requireEpisodeMatch: true,
      language: 'ko' as const,
      author: 'blog.naver.com',
      release: '장송의 프리렌 1화 자막',
      pageUrl: 'https://blog.naver.com/testauthor/100',
      score: 150,
      autoEligible: true,
    };

    const mockWebProvider = {
      id: 'web-ko',
      search: vi.fn(async () => [webCandidate]),
      download: vi.fn(async () => strToU8(srtBody).buffer),
    };

    // Anissia provider returns []
    const emptyAnissiaProvider = new AnissiaProvider(
      undefined,
      undefined,
      undefined,
      undefined,
      mockWebProvider as any,
    );

    const statusCalls: { stage: string; message: string; source?: string; path?: string }[] = [];
    const status = vi.fn((s) => statusCalls.push(s));

    const pipeline = new SubtitlePipeline(
      [emptyAnissiaProvider],
      defaultSettings,
      status,
      new AbortController().signal,
    );

    const result = await pipeline.resolve(animeContext, 'auto');
    expect(result).toMatchObject({
      language: 'ko',
      source: 'web-ko',
    });
    expect(result.cues.length).toBeGreaterThan(0);
    expect(mockWebProvider.search).toHaveBeenCalled();
    expect(mockWebProvider.download).toHaveBeenCalledWith(
      expect.objectContaining({ id: webCandidate.id }),
      expect.any(Object),
    );

    expect(statusCalls.some((s) => s.path === 'Web Search (KO)')).toBe(true);
    expect(statusCalls.some((s) => s.message === '웹 한국어 자막 사용 중')).toBe(true);
  });
});
