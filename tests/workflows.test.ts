import { describe, it, expect, vi } from 'vitest';
import 'fake-indexeddb/auto';
import type { SubtitleCue } from '../src/subtitle/SubtitleCue';
import { SubtitleCore } from '../src/subtitle/SubtitleCore';
import { AppError } from '../src/utils/errors';
import { defaultSettings } from '../src/storage/settings';
import { loadHLSSubtitles, englishRenditions } from '../src/subtitle/HLSSubtitles';
describe('independent modes and AUTO', () => {
  it('Mode 1 never falls through or calls LLM', async () => {
    const search = vi.fn(async () => []),
      fetchMock = vi.spyOn(globalThis, 'fetch');
    const core = new SubtitleCore(
      [{ id: 'anissia', search, download: vi.fn() }],
      defaultSettings,
      () => {},
      new AbortController().signal,
      vi.fn(),
    );
    await expect(
      core.run({ site: 'miruro', title: 'A', episode: 1, pageUrl: 'https://www.miruro.to' }, 'ko'),
    ).rejects.toThrow('한국어');
    expect(search).toHaveBeenCalledOnce();
    expect(search.mock.calls[0]).toHaveLength(3);
    expect(fetchMock).not.toHaveBeenCalled();
    fetchMock.mockRestore();
  });
  it('EN uses native cues when the first subtitle URL is unreachable', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('offline'));
    const search = vi.fn(),
      download = vi.fn();
    const original = [{ id: 0, startTime: 1, endTime: 3, text: 'Hello' }];
    const translated = vi.fn(async (cues: SubtitleCue[]) =>
      cues.map((cue) => ({ ...cue, text: '안녕' })),
    );
    class FallbackCore extends SubtitleCore {
      protected override translate(cues: SubtitleCue[]) {
        return translated(cues);
      }
    }
    const core = new FallbackCore(
      [{ id: 'anissia', search, download }],
      defaultSettings,
      () => {},
      new AbortController().signal,
      async () => [
        { kind: 'file', language: 'en', url: 'https://cdn.example/unreachable.vtt' },
        { kind: 'texttrack', language: 'en', cues: original },
      ],
    );
    try {
      expect(
        await core.run(
          { site: 'miruro', title: 'A', episode: 1, pageUrl: 'https://www.miruro.to' },
          'en',
        ),
      ).toEqual([{ ...original[0], text: '안녕' }]);
      expect(translated).toHaveBeenCalledOnce();
      expect(fetchMock).toHaveBeenCalledOnce();
      expect(search).not.toHaveBeenCalled();
      expect(download).not.toHaveBeenCalled();
    } finally {
      fetchMock.mockRestore();
    }
  });
  it('EN preserves a translation failure instead of repeating it with another source', async () => {
    const translated = vi.fn(async (_cues: SubtitleCue[]): Promise<SubtitleCue[]> => {
      throw new AppError('CONNECTION', 'model offline');
    });
    class FailedCore extends SubtitleCore {
      protected override translate(cues: SubtitleCue[]) {
        return translated(cues);
      }
    }
    const core = new FailedCore(
      [],
      defaultSettings,
      () => {},
      new AbortController().signal,
      async () => [
        {
          kind: 'texttrack',
          language: 'en',
          cues: [{ id: 0, startTime: 1, endTime: 3, text: 'Hello' }],
        },
        {
          kind: 'texttrack',
          language: 'en',
          cues: [{ id: 1, startTime: 5, endTime: 7, text: 'Again' }],
        },
      ],
    );
    await expect(
      core.run({ site: 'miruro', title: 'A', episode: 1, pageUrl: 'https://www.miruro.to' }, 'en'),
    ).rejects.toThrow('model offline');
    expect(translated).toHaveBeenCalledOnce();
  });
  it('extracts only English HLS rendition and preserves times', async () => {
    const master =
      '#EXTM3U\n#EXT-X-MEDIA:TYPE=SUBTITLES,LANGUAGE="en",NAME="English",URI="english.m3u8"\n#EXT-X-STREAM-INF:BANDWIDTH=1\nvideo.m3u8';
    expect(englishRenditions(master, 'https://cdn.example/master.m3u8')).toEqual([
      'https://cdn.example/english.m3u8',
    ]);
    const data: Record<string, string> = {
      'https://cdn.example/master.m3u8': master,
      'https://cdn.example/english.m3u8': '#EXTM3U\n#EXTINF:10,\n1.vtt\n#EXTINF:10,\n2.vtt',
      'https://cdn.example/1.vtt':
        'WEBVTT\nX-TIMESTAMP-MAP=LOCAL:00:00:00.000,MPEGTS:900000\n\n00:00:01.000 --> 00:00:03.000\nHello',
      'https://cdn.example/2.vtt':
        'WEBVTT\nX-TIMESTAMP-MAP=LOCAL:00:00:00.000,MPEGTS:1800000\n\n00:00:01.000 --> 00:00:03.000\nWorld',
    };
    const load = vi.fn(async (url: string) => data[url]);
    const cues = await loadHLSSubtitles('https://cdn.example/master.m3u8', load);
    expect(cues.map((c) => c.startTime)).toEqual([1, 11]);
    expect(load.mock.calls.some(([url]) => url.includes('video'))).toBe(false);
  });
});
