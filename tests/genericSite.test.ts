// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { episodeKey, contextKey } from '../src/anime/AnimeContext';
import { adapterFor, isSpecializedSite, isWebVideoUrl } from '../src/sites/adapter';
import { GenericVideoAdapter } from '../src/sites/generic/GenericVideoAdapter';
import { detectEmbedded } from '../src/content/subtitleSources';
import { bridgeStore, clearBridge } from '../src/content/bridgeStore';
import { SubtitlePipeline } from '../src/subtitle/SubtitlePipeline';
import { SubtitleCore } from '../src/subtitle/SubtitleCore';
import { defaultSettings } from '../src/storage/settings';
import { database } from '../src/storage/database';
import type { SubtitleProvider } from '../src/providers/SubtitleProvider';

beforeEach(async () => {
  await database.clear();
  clearBridge();
  document.body.innerHTML = '';
  document.title = '';
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('site URL classification and adapter selection', () => {
  it('distinguishes specialized anime sites from generic web URLs', () => {
    expect(isSpecializedSite('https://www.miruro.to/watch/frieren?ep=1')).toBe(true);
    expect(isSpecializedSite('https://miruro.to/watch/1')).toBe(true);
    expect(isSpecializedSite('https://reanime.to/watch/1')).toBe(true);
    expect(isSpecializedSite('https://www.youtube.com/watch?v=abc')).toBe(false);
    expect(isSpecializedSite('not-a-url')).toBe(false);

    expect(isWebVideoUrl('https://example.com/video')).toBe(true);
    expect(isWebVideoUrl('http://localhost:8080/watch')).toBe(true);
    expect(isWebVideoUrl('chrome://extensions')).toBe(false);
    expect(isWebVideoUrl('file:///tmp/video.mp4')).toBe(false);
    expect(isWebVideoUrl(undefined)).toBe(false);
  });

  it('returns GenericVideoAdapter only when allowGeneric is true on non-specialized http(s) pages', () => {
    const genericUrl = 'https://video.example.com/watch/intro';
    expect(adapterFor(genericUrl, false)).toBeUndefined();
    expect(adapterFor(genericUrl, true)).toBeInstanceOf(GenericVideoAdapter);
    expect(adapterFor('https://www.miruro.to/watch/test', true)?.constructor.name).toBe(
      'MiruroAdapter',
    );
    expect(adapterFor('https://reanime.to/watch/test', true)?.constructor.name).toBe(
      'ReAnimeAdapter',
    );
    expect(adapterFor('chrome://settings', true)).toBeUndefined();
  });

  it('builds distinct GenericVideoAdapter context and unique episode/context keys per URL path', async () => {
    const adapter = new GenericVideoAdapter();
    expect(adapter.matches('https://media.example.org/clip/1')).toBe(true);
    expect(adapter.matches('https://www.miruro.to/watch/1')).toBe(false);

    document.title = 'Shared Player Title';
    window.history.replaceState({}, '', '/videos/alpha/');
    const first = await adapter.getAnimeContext();
    window.history.replaceState({}, '', '/videos/beta');
    const second = await adapter.getAnimeContext();

    expect(first.site).toBe('generic');
    expect(first.title).toBe('Shared Player Title');
    expect(first.episode).toBe(1);
    expect(first.animeId).toBe(`${location.origin}/videos/alpha`);
    expect(second.animeId).toBe(`${location.origin}/videos/beta`);
    expect(episodeKey(first)).not.toBe(episodeKey(second));
    expect(contextKey(first)).not.toBe(contextKey(second));
  });

  it('distinguishes query-keyed video URLs while stripping transient/tracking query params and hashes', () => {
    const baseA = {
      site: 'generic' as const,
      title: 'Video',
      episode: 1,
      pageUrl: 'https://www.youtube.com/watch?v=abc',
    };
    const baseB = {
      site: 'generic' as const,
      title: 'Video',
      episode: 1,
      pageUrl: 'https://www.youtube.com/watch?v=xyz',
    };
    const trackedA = {
      site: 'generic' as const,
      title: 'Video',
      episode: 1,
      pageUrl: 'https://www.youtube.com/watch?v=abc&t=30s&utm_source=test&si=share123#player',
    };

    expect(episodeKey(baseA)).not.toBe(episodeKey(baseB));
    expect(contextKey(baseA)).not.toBe(contextKey(baseB));
    expect(episodeKey(trackedA)).toBe(episodeKey(baseA));
    expect(contextKey(trackedA)).toBe(contextKey(baseA));
  });
});

describe('embedded subtitle detection for generic web videos', () => {
  it('ignores AnimeSub/WebSub native tracks and returns non-English tracks when language is any', async () => {
    const video = document.createElement('video');
    const esTrack = document.createElement('track');
    esTrack.src = 'https://cdn.example/sub-es.vtt';
    esTrack.srclang = 'es';
    esTrack.label = 'Español';
    const undTrack = document.createElement('track');
    undTrack.src = 'https://cdn.example/captions.vtt';
    video.append(esTrack, undTrack);
    document.body.append(video);

    Object.defineProperty(video, 'textTracks', {
      configurable: true,
      value: [
        {
          kind: 'subtitles',
          label: '한국어 · AnimeSub',
          language: 'ko',
          mode: 'showing',
          cues: [{ startTime: 1, endTime: 2, text: 'ignore me' }],
        },
        {
          kind: 'subtitles',
          label: 'English · WebSub',
          language: 'en',
          mode: 'showing',
          cues: [{ startTime: 1, endTime: 2, text: 'ignore me too' }],
        },
        {
          kind: 'captions',
          label: 'Français',
          language: 'fr',
          mode: 'hidden',
          cues: [{ startTime: 1, endTime: 3, text: 'Bonjour' }],
        },
      ],
    });

    bridgeStore.sources.push({
      url: 'https://cdn.example/bridge-de.vtt',
      language: 'de',
      kind: 'file',
    });

    vi.spyOn(performance, 'getEntriesByType').mockReturnValue([
      { name: 'https://cdn.example/tracks/storyboard.vtt' } as PerformanceEntry,
      { name: 'https://cdn.example/tracks/thumbnail.vtt' } as PerformanceEntry,
      { name: 'https://cdn.example/tracks/pt-captions.srt' } as PerformanceEntry,
      { name: 'https://cdn.example/tracks/unknown.vtt' } as PerformanceEntry,
    ]);

    const anySources = await detectEmbedded('any');
    expect(anySources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ url: 'https://cdn.example/sub-es.vtt', language: 'es' }),
        expect.objectContaining({ url: 'https://cdn.example/captions.vtt', language: 'und' }),
        expect.objectContaining({ language: 'fr', kind: 'texttrack' }),
        expect.objectContaining({ url: 'https://cdn.example/bridge-de.vtt', language: 'de' }),
        expect.objectContaining({ url: 'https://cdn.example/tracks/pt-captions.srt', language: 'pt' }),
        expect.objectContaining({ url: 'https://cdn.example/tracks/unknown.vtt', language: 'und' }),
      ]),
    );
    expect(anySources.some((s) => s.label?.includes('AnimeSub') || s.label?.includes('WebSub'))).toBe(
      false,
    );
    expect(
      anySources.some((s) => s.url?.includes('storyboard') || s.url?.includes('thumbnail')),
    ).toBe(false);
  });
});

describe('SubtitlePipeline and SubtitleCore for generic sites', () => {
  const genericContext = {
    site: 'generic' as const,
    animeId: 'https://video.example.com/talk/1',
    title: 'Keynote Talk',
    episode: 1,
    pageUrl: 'https://video.example.com/talk/1',
  };

  it('skips anime-only external providers, prefers targetLanguage, falls back to English/other, and throws NOT_FOUND when empty', async () => {
    const provider = (id: string): SubtitleProvider => ({
      id,
      search: vi.fn(async () => []),
      download: vi.fn(async () => new ArrayBuffer(0)),
    });
    const providers = [provider('anissia'), provider('jimaku'), provider('kitsunekko')];

    const multiSources = vi.fn(async () => [
      {
        kind: 'texttrack' as const,
        language: 'es',
        cues: [{ id: 1, startTime: 1, endTime: 3, text: 'Hola' }],
      },
      {
        kind: 'texttrack' as const,
        language: 'en',
        cues: [{ id: 1, startTime: 1, endTime: 3, text: 'Hello' }],
      },
      {
        kind: 'texttrack' as const,
        language: 'ko',
        cues: [{ id: 1, startTime: 1, endTime: 3, text: '안녕하세요' }],
      },
    ]);

    const koRes = await new SubtitlePipeline(
      providers,
      { ...structuredClone(defaultSettings), targetLanguage: 'ko' },
      vi.fn(),
      new AbortController().signal,
      multiSources,
    ).resolve(genericContext, 'auto');
    expect(koRes).toEqual({
      cues: [{ id: 1, startTime: 1, endTime: 3, text: '안녕하세요' }],
      language: 'ko',
      source: 'embedded-generic',
    });
    for (const p of providers) expect(p.search).not.toHaveBeenCalled();

    const fallbackSources = vi.fn(async () => [
      {
        kind: 'texttrack' as const,
        language: 'es',
        cues: [{ id: 1, startTime: 1, endTime: 3, text: 'Hola' }],
      },
      {
        kind: 'texttrack' as const,
        language: 'en',
        cues: [{ id: 1, startTime: 1, endTime: 3, text: 'Hello' }],
      },
    ]);
    const enRes = await new SubtitlePipeline(
      providers,
      { ...structuredClone(defaultSettings), targetLanguage: 'ko' },
      vi.fn(),
      new AbortController().signal,
      fallbackSources,
    ).resolve(genericContext, 'auto');
    expect(enRes.language).toBe('en');
    expect(enRes.source).toBe('embedded-generic');

    await expect(
      new SubtitlePipeline(
        providers,
        structuredClone(defaultSettings),
        vi.fn(),
        new AbortController().signal,
        async () => [],
      ).resolve(genericContext, 'auto'),
    ).rejects.toThrow('내장 자막을 찾지 못했습니다');
  });

  it('skips AI translation when embedded track matches targetLanguage and translates with contentKind general otherwise', async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? '{}'));
      const system = body.systemInstruction?.parts?.[0]?.text ?? '';
      expect(system).toContain('professional video subtitle translator');
      expect(system).not.toContain('anime subtitle translator');
      return new Response(
        JSON.stringify({
          candidates: [
            {
              finishReason: 'STOP',
              content: {
                parts: [
                  { text: JSON.stringify({ translations: [{ id: 1, text: 'Hello world' }] }) },
                ],
              },
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    });
    vi.stubGlobal('fetch', fetchMock);

    const matchingSettings = structuredClone(defaultSettings);
    matchingSettings.targetLanguage = 'es';
    const esCore = new SubtitleCore(
      [],
      matchingSettings,
      vi.fn(),
      new AbortController().signal,
      async () => [
        {
          kind: 'texttrack',
          language: 'es',
          cues: [{ id: 1, startTime: 1, endTime: 3, text: 'Hola mundo' }],
        },
      ],
    );
    expect(await esCore.run(genericContext, 'auto')).toEqual([
      { id: 1, startTime: 1, endTime: 3, text: 'Hola mundo' },
    ]);
    expect(fetchMock).not.toHaveBeenCalled();

    const translateSettings = structuredClone(defaultSettings);
    translateSettings.targetLanguage = 'en';
    translateSettings.translation.provider = 'gemini';
    translateSettings.translation.geminiApiKey = 'test-key';
    translateSettings.translation.geminiModel = 'gemini-2.5-flash';
    const translateCore = new SubtitleCore(
      [],
      translateSettings,
      vi.fn(),
      new AbortController().signal,
      async () => [
        {
          kind: 'texttrack',
          language: 'es',
          cues: [{ id: 1, startTime: 1, endTime: 3, text: 'Hola mundo' }],
        },
      ],
    );
    expect(await translateCore.run(genericContext, 'auto')).toEqual([
      { id: 1, startTime: 1, endTime: 3, text: 'Hello world' },
    ]);
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
