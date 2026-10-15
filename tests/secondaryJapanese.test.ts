import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { database } from '../src/storage/database';
import { secondaryJapanese } from '../src/subtitle/SecondaryJapanese';
import type { SubtitleProvider } from '../src/providers/SubtitleProvider';
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
