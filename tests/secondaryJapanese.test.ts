import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { database } from '../src/storage/database';
import {
  secondaryJapanese,
  alignJapaneseCues,
  boundaryAlignmentScore,
} from '../src/subtitle/SecondaryJapanese';
import type { SubtitleProvider } from '../src/providers/SubtitleProvider';
import type { SubtitleCue } from '../src/subtitle/SubtitleCue';
import { defaultSettings, normalizeSettings, validateSettings } from '../src/storage/settings';

const c = {
  site: 'miruro' as const,
  title: 'Test Show',
  episode: 1,
  pageUrl: 'https://www.miruro.to/watch/test?ep=1',
};
const provider = (id: string, found = true): SubtitleProvider => ({
  id,
  search: vi.fn(async () =>
    found
      ? [
          {
            id,
            providerId: id,
            title: c.title,
            release: 'Test Show E01.srt',
            episode: 1,
            filename: 'Test Show E01.srt',
            language: 'ja' as const,
            downloadUrl: 'https://jimaku.cc/E01.srt',
          },
        ]
      : [],
  ),
  download: vi.fn(
    async () => new TextEncoder().encode('1\n00:00:01,000 --> 00:00:04,000\n日本語の原文').buffer,
  ),
});
afterEach(() => vi.unstubAllGlobals());
beforeEach(() => database.clear());
describe('additional Japanese is a real source, never another translation', () => {
  it('downloads usable Jimaku Japanese without calling a translator or mirror', async () => {
    const jimaku = provider('jimaku'),
      mirror = provider('kitsunekko');
    const embedded = vi.fn(async () => []);
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const result = await secondaryJapanese(
      c,
      [jimaku, mirror],
      new AbortController().signal,
      embedded,
    );
    expect(result).toMatchObject({ source: 'jimaku', cues: [{ text: '日本語の原文' }] });
    expect(mirror.search).not.toHaveBeenCalled();
    expect(embedded).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });
  it('falls back to Kitsunekko when Jimaku is missing', async () => {
    expect(
      (
        await secondaryJapanese(
          c,
          [provider('jimaku', false), provider('kitsunekko')],
          new AbortController().signal,
          async () => [],
        )
      )?.source,
    ).toBe('kitsunekko');
  });
  it('uses embedded Japanese and skips duplicate external searches after AUTO English fallback', async () => {
    const providers = [provider('jimaku'), provider('kitsunekko')];
    const result = await secondaryJapanese(
      c,
      providers,
      new AbortController().signal,
      async () => [
        {
          kind: 'texttrack',
          language: 'en',
          cues: [{ id: 1, startTime: 1, endTime: 4, text: 'English' }],
        },
        {
          kind: 'texttrack',
          language: 'ja-JP',
          cues: [{ id: 9, startTime: 1, endTime: 5, text: '日本語' }],
        },
      ],
      true,
    );
    expect(result).toMatchObject({ source: 'embedded-ja', cues: [{ id: 9, text: '日本語' }] });
    for (const p of providers) expect(p.search).not.toHaveBeenCalled();
  });
  it('does not substitute English text for a missing Japanese track', async () => {
    expect(
      await secondaryJapanese(c, [], new AbortController().signal, async () => [
        {
          kind: 'texttrack',
          language: 'en',
          cues: [{ id: 1, startTime: 1, endTime: 4, text: 'English' }],
        },
      ]),
    ).toBeUndefined();
  });
  it('propagates cancellation instead of applying an older episode', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      secondaryJapanese(c, [provider('jimaku')], controller.signal, async () => []),
    ).rejects.toThrow();
  });

  it('alignJapaneseCues shifts delayed target cues by -10.0 seconds to match reference timestamps', () => {
    const referenceCues: SubtitleCue[] = Array.from({ length: 25 }, (_, i) => ({
      id: i + 1,
      startTime: i * 4,
      endTime: i * 4 + 2,
      text: `한국어 대사 ${i + 1}`,
    }));
    // +10초 밀려 있는 일본어 TV 방송 자막
    const targetCues: SubtitleCue[] = referenceCues.map((cue) => ({
      ...cue,
      startTime: cue.startTime + 10.0,
      endTime: cue.endTime + 10.0,
      text: `日本語セリフ ${cue.id}`,
    }));

    const aligned = alignJapaneseCues(referenceCues, targetCues);
    expect(aligned.offsetSeconds).toBe(-10);
    expect(aligned.cues).toHaveLength(25);
    expect(aligned.cues[0].startTime).toBe(0);
    expect(aligned.cues[0].endTime).toBe(2);
    expect(aligned.cues[10].startTime).toBe(referenceCues[10].startTime);
    expect(aligned.cues[10].endTime).toBe(referenceCues[10].endTime);
    expect(aligned.score).toBeGreaterThan(15);
  });

  it('secondaryJapanese automatically corrects +10.0s offset using Korean reference cues', async () => {
    const starts = [
      1.2, 3.5, 7.8, 12.1, 15.4, 19.8, 24.2, 28.6, 33.1, 38.4, 43.0, 48.2, 53.5, 59.1, 64.7, 70.2,
      75.8, 81.3, 87.0, 92.4, 98.1, 104.5,
    ];
    const referenceCues: SubtitleCue[] = starts.map((s, i) => ({
      id: i + 1,
      startTime: s,
      endTime: s + 2.0,
      text: `한국어 ${i + 1}`,
    }));

    const srtLines = referenceCues
      .map((cue, i) => {
        const s = cue.startTime + 10;
        const e = cue.endTime + 10;
        const fmt = (t: number) => {
          const m = String(Math.floor(t / 60)).padStart(2, '0');
          const sec = String(Math.floor(t % 60)).padStart(2, '0');
          const ms = String(Math.round((t % 1) * 1000)).padStart(3, '0');
          return `00:${m}:${sec},${ms}`;
        };
        return `${i + 1}\n${fmt(s)} --> ${fmt(e)}\n日本語 ${i + 1}`;
      })
      .join('\n\n');

    const delayedProvider: SubtitleProvider = {
      id: 'jimaku',
      search: vi.fn(async () => [
        {
          id: 'test-delayed',
          providerId: 'jimaku',
          title: c.title,
          release: 'Test Show S01E01 (AT-X).srt',
          episode: 1,
          filename: 'Test Show S01E01 (AT-X).srt',
          language: 'ja' as const,
          downloadUrl: 'https://jimaku.cc/delayed.srt',
        },
      ]),
      download: vi.fn(async () => new TextEncoder().encode(srtLines).buffer),
    };

    const result = await secondaryJapanese(
      c,
      [delayedProvider],
      new AbortController().signal,
      async () => [],
      false,
      referenceCues,
    );

    expect(result).toBeDefined();
    expect(result?.cues).toHaveLength(22);
    expect(result?.cues[0].startTime).toBeCloseTo(referenceCues[0].startTime, 2);
    expect(result?.cues[0].endTime).toBeCloseTo(referenceCues[0].endTime, 2);
    expect(result?.cues[10].startTime).toBeCloseTo(referenceCues[10].startTime, 2);
  });
});
describe('Japanese display migration and input validation', () => {
  it('keeps existing display settings and makes the additional track opt-in', () => {
    const old = { display: { fontSize: 36 } } as unknown as Partial<typeof defaultSettings>;
    expect(normalizeSettings(old).display).toMatchObject({
      fontSize: 36,
      showJapanese: false,
      japaneseFontSize: 22,
      japaneseOffset: 0,
    });
  });
  it.each([
    { showJapanese: 'yes' },
    { japaneseFontSize: 11 },
    { japaneseOffset: 11 },
    { japaneseFontSize: NaN },
  ])('rejects invalid extra-track settings: %o', (invalid) => {
    const s = structuredClone(defaultSettings);
    Object.assign(s.display, invalid);
    expect(() => validateSettings(s)).toThrow('설정');
  });
});
