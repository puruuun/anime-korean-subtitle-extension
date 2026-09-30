import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AnimeContext } from '../src/anime/AnimeContext';
import type { Settings } from '../src/storage/settings';
import type { SubtitleCue } from '../src/subtitle/SubtitleCue';
import type { CoreStatus, Mode, ProgressiveHooks } from '../src/subtitle/SubtitleCore';
import type {
  TranslationBufferStatus,
  TranslationQueue,
} from '../src/translation/TranslationQueue';

interface CoreControl {
  signal: AbortSignal;
  status: (value: CoreStatus) => void;
  progressive: ProgressiveHooks;
  finish: (cues: SubtitleCue[]) => void;
}
const harness = vi.hoisted(() => ({
  cores: [] as CoreControl[],
  sent: [] as { tabId: number; message: Record<string, unknown> }[],
  apply: vi.fn(),
  clear: vi.fn(),
}));

vi.mock('../src/subtitle/SubtitleCore', () => ({
  SubtitleCore: class {
    constructor(
      _providers: unknown,
      _settings: Settings,
      public status: (value: CoreStatus) => void,
      public signal: AbortSignal,
      _collect: unknown,
      public progressive: ProgressiveHooks,
    ) {}
    run(_context: AnimeContext, _mode: Mode) {
      return new Promise<SubtitleCue[]>((resolve) => {
        harness.cores.push({
          signal: this.signal,
          status: this.status,
          progressive: this.progressive,
          finish: resolve,
        });
      });
    }
  },
  SelectionRequired: class extends Error {
    results = [];
  },
}));
vi.mock('../src/storage/settings', async () => {
  const actual =
    await vi.importActual<typeof import('../src/storage/settings')>('../src/storage/settings');
  return { ...actual, getSettings: async () => structuredClone(actual.defaultSettings) };
});
vi.mock('../src/providers/createProviders', () => ({ createProviders: () => [] }));
vi.mock('../src/anime/AnimeResolver', () => ({
  resolveAnime: async (context: AnimeContext) => context,
}));
vi.mock('../src/storage/offsets', () => ({ getOffset: async () => 0 }));
vi.mock('../src/background/frameManager', () => ({
  applyCues: harness.apply,
  clearFrames: harness.clear,
  collectSubtitles: async () => [],
  videoFrames: async () => [{ frameId: 7, documentId: 'player-document' }],
  supportedSite: (url: string) => url.includes('miruro.to'),
  sendVideoMessage: async (tabId: number, message: Record<string, unknown>) => {
    harness.sent.push({ tabId, message: structuredClone(message) });
    return [];
  },
}));

const context: AnimeContext = {
  site: 'miruro',
  title: 'Router progressive test',
  episode: 1,
  pageUrl: 'https://www.miruro.to/watch/router?ep=1',
};
const cues: SubtitleCue[] = [
  { id: 1, startTime: 0, endTime: 10, text: '첫 자막' },
  { id: 2, startTime: 11, endTime: 20, text: '다음 자막' },
  { id: 5, startTime: 70, endTime: 80, text: 'Seek 뒤 자막' },
];
const buffer = (firstComplete = false): TranslationBufferStatus => ({
  playbackTime: 0,
  translatedUntil: firstComplete ? 21 : 0,
  bufferSeconds: firstComplete ? 21 : 0,
  targetBufferSeconds: 300,
  completedChunks: firstComplete ? 1 : 0,
  totalChunks: 3,
  failedChunks: 0,
  chunks: [
    {
      index: 0,
      startTime: 0,
      endTime: 20,
      state: firstComplete ? 'completed' : 'pending',
      attempts: 1,
    },
    { index: 1, startTime: 21, endTime: 60, state: 'pending', attempts: 0 },
    { index: 2, startTime: 70, endTime: 80, state: 'pending', attempts: 0 },
  ],
});
let storage: Map<string, unknown>;
let tabGet: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.resetModules();
  harness.cores.length = 0;
  harness.sent.length = 0;
  harness.apply.mockClear();
  harness.clear.mockClear();
  storage = new Map();
  tabGet = vi.fn(async () => ({ id: 9, url: context.pageUrl }));
  vi.stubGlobal('chrome', {
    runtime: { id: 'test-extension', getURL: (path: string) => 'chrome-extension://test/' + path },
    tabs: {
      get: tabGet,
      sendMessage: vi.fn(async (_tabId: number, message: { type: string }) =>
        message.type === 'PLAYBACK' ? { ok: true, currentTime: 201 } : { ok: true },
      ),
      onRemoved: { addListener: vi.fn() },
    },
    webNavigation: { getAllFrames: async () => [{ frameId: 7 }] },
    storage: {
      session: {
        get: async (key: string) => ({ [key]: structuredClone(storage.get(key)) }),
        set: async (values: Record<string, unknown>) => {
          for (const [key, value] of Object.entries(values))
            storage.set(key, structuredClone(value));
        },
        remove: async (keys: string | string[]) => {
          for (const key of Array.isArray(keys) ? keys : [keys]) storage.delete(key);
        },
      },
    },
  });
});

describe('progressive job lifecycle', () => {
  it('registers and persists partial cues while the episode translation is still running', async () => {
    const router = await import('../src/background/messageRouter');
    const started = await router.startJob(9, 'en', context);
    await vi.waitFor(() => expect(harness.cores).toHaveLength(1));
    const core = harness.cores[0];
    let snapshot = buffer();
    const updatePlayback = vi.fn();
    const queue = { updatePlayback, snapshot: () => snapshot } as unknown as TranslationQueue;
    await core.progressive.onStart(cues, 'en', queue);
    snapshot = buffer(true);
    await core.progressive.onChunk(cues.slice(0, 2), snapshot);
    expect(storage.get('render:9')).toMatchObject({
      cues: cues.slice(0, 2),
      bootstrapReady: true,
      epoch: started.epoch,
    });
    expect(harness.sent.map(({ message }) => message.type)).toContain('APPEND');
    expect(harness.sent.map(({ message }) => message.type)).toContain('BOOTSTRAP_READY');
    expect((await router.currentStatus(9))?.busy).toBe(true);
    expect(harness.apply).not.toHaveBeenCalled();
    // A later delta is merged into the memory store and persisted as a full restart snapshot.
    await core.progressive.onChunk(cues.slice(2), snapshot);
    expect(storage.get('render:9')).toMatchObject({ cues });
    await router.cancelJob(9);
    core.finish(cues);
    await Promise.resolve();
  });

  it('accepts seek priority only from the current video document and matching epoch', async () => {
    const router = await import('../src/background/messageRouter');
    const started = await router.startJob(9, 'en', context);
    await vi.waitFor(() => expect(harness.cores).toHaveLength(1));
    const updatePlayback = vi.fn();
    const queue = { updatePlayback, snapshot: () => buffer() } as unknown as TranslationQueue;
    await harness.cores[0].progressive.onStart(cues, 'en', queue);
    updatePlayback.mockClear();
    const sender: chrome.runtime.MessageSender = { frameId: 7, documentId: 'player-document' };
    for (const [source, message] of [
      [sender, { epoch: started.epoch - 1, currentTime: 1080, seek: true }],
      [
        { ...sender, frameId: 0 },
        { epoch: started.epoch, currentTime: 1080, seek: true },
      ],
      [
        { ...sender, documentId: 'old-document' },
        { epoch: started.epoch, currentTime: 1080, seek: true },
      ],
      [sender, { epoch: started.epoch, currentTime: NaN, seek: true }],
    ] as const) {
      await router.reportPlayback(9, source, message);
    }
    expect(updatePlayback).not.toHaveBeenCalled();
    await router.reportPlayback(9, sender, { epoch: started.epoch, currentTime: 1080, seek: true });
    expect(updatePlayback).toHaveBeenCalledExactlyOnceWith(1080, true);
    await router.cancelJob(9);
    await router.reportPlayback(9, sender, { epoch: started.epoch, currentTime: 1200, seek: true });
    expect(updatePlayback).toHaveBeenCalledTimes(1);
    harness.cores[0].finish([]);
    await Promise.resolve();
  });

  it('serializes competing starts and cancel so an old worker cannot repopulate a newer job', async () => {
    const router = await import('../src/background/messageRouter');
    let openFirst!: () => void;
    let openSecond!: () => void;
    tabGet
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            openFirst = () => resolve({ id: 9, url: context.pageUrl });
          }),
      )
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            openSecond = () => resolve({ id: 9, url: context.pageUrl });
          }),
      );
    const first = router.startJob(9, 'en', context);
    const second = router.startJob(9, 'en', { ...context, episode: 2 });
    const cancelled = router.cancelJob(9);
    await vi.waitFor(() => expect(tabGet).toHaveBeenCalledTimes(1));
    openFirst();
    const firstStatus = await first;
    await vi.waitFor(() => expect(harness.cores).toHaveLength(1));
    await vi.waitFor(() => expect(tabGet).toHaveBeenCalledTimes(2));
    expect(harness.cores[0].signal.aborted).toBe(false);
    openSecond();
    const secondStatus = await second;
    await cancelled;
    expect(secondStatus.epoch).toBeGreaterThan(firstStatus.epoch);
    expect(harness.cores.every((core) => core.signal.aborted)).toBe(true);
    expect(storage.has('job:9')).toBe(false);
    expect(storage.has('render:9')).toBe(false);
    expect(storage.has('follow:9')).toBe(false);
    const sentBefore = harness.sent.length;
    for (const core of harness.cores) {
      core.status({
        stage: 'translate',
        message: 'late obsolete completion',
        translation: buffer(true),
      });
      await core.progressive.onChunk(cues, buffer(true));
      core.finish(cues);
    }
    await Promise.resolve();
    await Promise.resolve();
    expect(harness.sent).toHaveLength(sentBefore);
    expect(storage.has('job:9')).toBe(false);
    expect(storage.has('render:9')).toBe(false);
    expect(await router.currentStatus(9)).toBeUndefined();
  });
});
