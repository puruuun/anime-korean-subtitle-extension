import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const tabUrl = 'https://www.miruro.to/watch/test?ep=1';

describe('frameManager', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('collectSubtitles ignores undefined or null frame replies while keeping valid sources', async () => {
    const sendMessage = vi.fn(async (_tabId: number, msg: { type: string }, opts: { frameId: number }) => {
      if (msg.type === 'FRAME_PROBE') return { video: true };
      if (opts.frameId === 0) return undefined;
      if (opts.frameId === 1) return null;
      return {
        sources: [{ id: 's1', label: 'English', language: 'en', kind: 'vtt', url: 'https://cdn.example/1.vtt' }],
      };
    });

    vi.stubGlobal('chrome', {
      tabs: {
        get: vi.fn(async () => ({ id: 1, url: tabUrl })),
        sendMessage,
        onRemoved: { addListener: vi.fn() },
      },
      webNavigation: {
        getAllFrames: vi.fn(async () => [{ frameId: 0 }, { frameId: 1 }, { frameId: 2 }]),
        onCommitted: { addListener: vi.fn() },
      },
      scripting: { executeScript: vi.fn() },
    });

    const fm = await import('../src/background/frameManager');
    await fm.recordFrame(
      { tab: { id: 1 } as chrome.tabs.Tab, frameId: 1, url: 'https://player.example/1' },
      true,
      100,
    );
    await fm.recordFrame(
      { tab: { id: 1 } as chrome.tabs.Tab, frameId: 2, url: 'https://player.example/2' },
      true,
      200,
    );

    const sources = await fm.collectSubtitles(1);
    expect(sources).toEqual([
      { id: 's1', label: 'English', language: 'en', kind: 'vtt', url: 'https://cdn.example/1.vtt' },
    ]);
  });

  it('forgetTabFrames clears recorded frame state for a closed tab', async () => {
    vi.stubGlobal('chrome', {
      tabs: {
        get: vi.fn(async () => ({ id: 42, url: tabUrl })),
        sendMessage: vi.fn(async () => null),
        onRemoved: { addListener: vi.fn() },
      },
      webNavigation: {
        getAllFrames: vi.fn(async () => [{ frameId: 0, url: tabUrl, parentFrameId: -1 }]),
        onCommitted: { addListener: vi.fn() },
      },
      scripting: { executeScript: vi.fn() },
    });

    const fm = await import('../src/background/frameManager');
    await fm.recordFrame(
      { tab: { id: 42 } as chrome.tabs.Tab, frameId: 0, url: tabUrl },
      true,
      500,
    );

    const before = await fm.frameInventory(42);
    expect(before[0]).toMatchObject({ frameId: 0, hasVideo: true, area: 500 });

    fm.forgetTabFrames(42);

    const after = await fm.frameInventory(42);
    expect(after[0].hasVideo).toBeUndefined();
    expect(after[0].area).toBeUndefined();
  });

  it('activates generic tabs, checks supportedTab against activeGenericTabs and allowedGenericHosts, and forwards language in collectSubtitles', async () => {
    const genericUrl = 'https://video.example.com/watch/123';
    const executeScript = vi.fn(async () => []);
    const sendMessage = vi.fn(async (_tabId: number, msg: { type: string; language?: string }) => {
      if (msg.type === 'FRAME_PROBE') return { video: true };
      if (msg.type === 'SOURCES') {
        expect(msg.language).toBe('any');
        return { sources: [{ language: 'es', kind: 'file', url: 'https://cdn.example/es.vtt' }] };
      }
      return null;
    });

    vi.stubGlobal('chrome', {
      storage: {
        local: {
          get: vi.fn(async () => ({ settings: { allowedGenericHosts: ['auto.example.com'] } })),
          set: vi.fn(),
        },
      },
      tabs: {
        get: vi.fn(async (tabId: number) => ({
          id: tabId,
          url: tabId === 99 ? 'https://auto.example.com/clip' : genericUrl,
        })),
        sendMessage,
        onRemoved: { addListener: vi.fn() },
      },
      webNavigation: {
        getAllFrames: vi.fn(async () => [{ frameId: 0 }, { frameId: 5 }]),
        onCommitted: { addListener: vi.fn() },
      },
      scripting: { executeScript },
    });

    const fm = await import('../src/background/frameManager');
    expect(await fm.supportedTab(10)).toBe(false);
    expect(fm.isGenericTabActive(10)).toBe(false);
    expect(await fm.supportedTab(99)).toBe(true);

    await fm.activateGenericTab(10);
    expect(fm.isGenericTabActive(10)).toBe(true);
    expect(await fm.supportedTab(10)).toBe(true);
    expect(executeScript).toHaveBeenCalledTimes(4);

    const sources = await fm.collectSubtitles(10, 'any');
    expect(sources).toEqual([
      { language: 'es', kind: 'file', url: 'https://cdn.example/es.vtt' },
    ]);

    fm.forgetTabFrames(10);
    expect(fm.isGenericTabActive(10)).toBe(false);
    expect(await fm.supportedTab(10)).toBe(false);
  });
});
