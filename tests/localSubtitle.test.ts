import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import 'fake-indexeddb/auto';
import type { AnimeContext } from '../src/anime/AnimeContext';
import type { SubtitleCue } from '../src/subtitle/SubtitleCue';
import {
  MAX_LOCAL_SUBTITLE_BYTES,
  decodeBase64ToBytes,
  encodeBytesToBase64,
  parseLocalSubtitleBytes,
} from '../src/subtitle/localSubtitle';
import { AppError } from '../src/utils/errors';

const harness = vi.hoisted(() => ({
  sent: [] as { tabId: number; message: Record<string, unknown> }[],
  apply: vi.fn(async () => {}),
  clear: vi.fn(async () => {}),
  forgetTabFrames: vi.fn(),
  translate: vi.fn(),
  targetLanguage: 'ko',
}));

vi.mock('../src/translation/createTranslationProvider', () => ({
  createTranslationProvider: () => ({
    id: 'gemini',
    translate: harness.translate,
  }),
}));

vi.mock('../src/storage/settings', async () => {
  const actual =
    await vi.importActual<typeof import('../src/storage/settings')>('../src/storage/settings');
  return {
    ...actual,
    getSettings: async () => {
      const s = structuredClone(actual.defaultSettings);
      s.targetLanguage = harness.targetLanguage;
      s.translation.provider = 'gemini';
      s.translation.geminiModel = 'gemini-2.5-flash';
      s.translation.geminiApiKey = 'test-key';
      return s;
    },
  };
});

vi.mock('../src/storage/offsets', () => ({ getOffset: async () => 0 }));
vi.mock('../src/providers/createProviders', () => ({ createProviders: () => [] }));
vi.mock('../src/anime/AnimeResolver', () => ({
  resolveAnime: async (context: AnimeContext) => context,
}));
vi.mock('../src/background/frameManager', () => ({
  applyCues: harness.apply,
  injectFrames: async () => {},
  clearFrames: harness.clear,
  collectSubtitles: async () => [],
  videoFrames: async () => [{ frameId: 7, documentId: 'player-doc' }],
  supportedSite: (url?: string) => !!url && url.includes('miruro.to'),
  supportedTab: async () => true,
  forgetTabFrames: harness.forgetTabFrames,
  sendVideoMessage: async (tabId: number, message: Record<string, unknown>) => {
    harness.sent.push({ tabId, message: structuredClone(message) });
    return [];
  },
}));

const context: AnimeContext = {
  site: 'generic',
  animeId: 'https://example.com/watch',
  title: 'Local Test Video',
  episode: 1,
  pageUrl: 'https://example.com/watch',
};

const sampleCues: SubtitleCue[] = [
  { id: 1, startTime: 1, endTime: 3, text: 'Hello world' },
  { id: 2, startTime: 4, endTime: 6, text: 'Second line' },
];

describe('localSubtitle base64 & parsing', () => {
  it('round-trips multi-byte UTF-8 and >100KB buffers without stack overflow', () => {
    const text = '안녕하세요 · こんにちは · Hello\n'.repeat(5000);
    const bytes = new TextEncoder().encode(text);
    expect(bytes.byteLength).toBeGreaterThan(100 * 1024);

    const encoded = encodeBytesToBase64(bytes);
    const decoded = decodeBase64ToBytes(encoded);
    expect(decoded).toEqual(bytes);
    expect(new TextDecoder().decode(decoded)).toBe(text);
  });

  it('parses valid .srt, .vtt, .ass, and .smi files cleanly', () => {
    const enc = new TextEncoder();

    const srt = '1\n00:00:01,000 --> 00:00:03,000\nHello SRT\n';
    expect(parseLocalSubtitleBytes('episode1.srt', enc.encode(srt))).toEqual({
      format: 'srt',
      cues: [{ id: 1, startTime: 1, endTime: 3, text: 'Hello SRT' }],
    });

    const vtt = 'WEBVTT\n\n00:00:02.000 --> 00:00:04.500\nHello VTT\n';
    expect(parseLocalSubtitleBytes('episode1.VTT', enc.encode(vtt))).toEqual({
      format: 'vtt',
      cues: [{ id: 1, startTime: 2, endTime: 4.5, text: 'Hello VTT' }],
    });

    const ass =
      '[Script Info]\nTitle: Test\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\nDialogue: 0,0:00:05.00,0:00:08.00,Default,,0,0,0,,Hello ASS\n';
    expect(parseLocalSubtitleBytes('episode1.ass', enc.encode(ass))).toEqual({
      format: 'ass',
      cues: [{ id: 1, startTime: 5, endTime: 8, text: 'Hello ASS' }],
    });

    const smi = '<SAMI><BODY><SYNC Start=1000><P Class=KRCC>안녕 SMI</P><SYNC Start=3000><P Class=KRCC>&nbsp;</P></BODY></SAMI>';
    expect(parseLocalSubtitleBytes('episode1.smi', enc.encode(smi))).toEqual({
      format: 'smi',
      cues: [{ id: 1, startTime: 1, endTime: 3, text: '안녕 SMI' }],
    });
  });

  it('rejects non-subtitle extensions with FORMAT error', () => {
    const bytes = new TextEncoder().encode('dummy');
    for (const name of ['video.mp4', 'movie.mkv', 'seg.ts', 'audio.mp3', 'sub.zip', 'notes.txt']) {
      try {
        parseLocalSubtitleBytes(name, bytes);
        expect.unreachable(`Expected FORMAT error for ${name}`);
      } catch (error) {
        expect(error).toBeInstanceOf(AppError);
        expect((error as AppError).code).toBe('FORMAT');
      }
    }
  });

  it('rejects empty buffers (PARSE) and >5 MiB buffers (SIZE)', () => {
    try {
      parseLocalSubtitleBytes('empty.srt', new Uint8Array(0));
      expect.unreachable('Expected PARSE error');
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).code).toBe('PARSE');
    }

    const oversized = new Uint8Array(MAX_LOCAL_SUBTITLE_BYTES + 1);
    try {
      parseLocalSubtitleBytes('huge.srt', oversized);
      expect.unreachable('Expected SIZE error');
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).code).toBe('SIZE');
    }
  });

  it('rejects unparseable or cue-less subtitle content with PARSE error', () => {
    const garbage = new TextEncoder().encode('not a subtitle at all');
    try {
      parseLocalSubtitleBytes('broken.srt', garbage);
      expect.unreachable('Expected PARSE error');
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).code).toBe('PARSE');
    }
  });
});

describe('applyLocalSubtitle', () => {
  let storage: Map<string, unknown>;

  beforeEach(() => {
    vi.resetModules();
    harness.sent.length = 0;
    harness.apply.mockClear();
    harness.clear.mockClear();
    harness.forgetTabFrames.mockClear();
    harness.translate.mockReset();
    harness.targetLanguage = 'ko';
    storage = new Map();
    vi.stubGlobal('chrome', {
      runtime: { id: 'test-ext', getURL: (p: string) => 'chrome-extension://test/' + p },
      tabs: {
        get: vi.fn(async (tabId: number) => ({ id: tabId, url: context.pageUrl })),
        query: async () => [{ id: 9, url: context.pageUrl }],
        sendMessage: vi.fn(async (_tabId: number, message: { type: string }) =>
          message.type === 'PLAYBACK' ? { ok: true, currentTime: 0 } : { ok: true },
        ),
        onRemoved: { addListener: vi.fn() },
      },
      webNavigation: { getAllFrames: async () => [{ frameId: 7 }] },
      storage: {
        session: {
          get: async (keys: string | string[]) =>
            Object.fromEntries(
              (Array.isArray(keys) ? keys : [keys]).map((key) => [
                key,
                structuredClone(storage.get(key)),
              ]),
            ),
          set: async (values: Record<string, unknown>) => {
            for (const [key, value] of Object.entries(values)) {
              storage.set(key, structuredClone(value));
            }
          },
          remove: async (keys: string | string[]) => {
            for (const key of Array.isArray(keys) ? keys : [keys]) storage.delete(key);
          },
        },
      },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('applies cues directly without invoking translation when translate is false', async () => {
    const router = await import('../src/background/messageRouter');
    const status = await router.applyLocalSubtitle(9, context, sampleCues, {
      fileName: 'local.srt',
      translate: false,
    });

    expect(status.source).toBe('local-file');
    expect(status.stage).toBe('done');
    expect(status.busy).toBe(false);
    expect(status.path).toBe('Local File · local.srt');
    expect(harness.apply).toHaveBeenCalledTimes(1);
    expect(harness.apply).toHaveBeenCalledWith(
      9,
      sampleCues,
      expect.any(Object),
      0,
      status.epoch,
      'ko',
    );
    expect(harness.translate).not.toHaveBeenCalled();
    expect(storage.get('render:9')).toBeTruthy();
  });

  it('invokes translation provider and updates frames progressively when translate is true', async () => {
    harness.translate.mockImplementation(
      async (
        cuesToTranslate: { id: number; text: string }[],
        opts: { targetLanguage?: string; contentKind?: string },
      ) => {
        expect(opts.targetLanguage).toBe('ko');
        expect(opts.contentKind).toBe('general');
        return cuesToTranslate.map((c) => ({
          id: c.id,
          text: `[KO] ${c.text}`,
        }));
      },
    );

    const router = await import('../src/background/messageRouter');
    const initial = await router.applyLocalSubtitle(9, context, sampleCues, {
      fileName: 'foreign.srt',
      translate: true,
    });

    expect(initial.source).toBe('local-file');
    expect(initial.busy).toBe(true);

    await vi.waitFor(async () => {
      const current = await router.currentStatus(9);
      expect(current?.busy).toBe(false);
      expect(current?.stage).toBe('done');
    });

    expect(harness.translate).toHaveBeenCalledTimes(1);
    const messageTypes = harness.sent.map((entry) => entry.message.type);
    expect(messageTypes).toContain('PREPARE');
    expect(messageTypes).toContain('APPEND');
    expect(messageTypes).toContain('BOOTSTRAP_READY');
  });
});
