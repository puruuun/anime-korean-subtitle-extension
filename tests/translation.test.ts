import { describe, it, expect, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { chunkCues, TranslationManager } from '../src/translation/TranslationManager';
import { validateTranslations } from '../src/translation/TranslationProvider';
import { TranslationCache } from '../src/translation/TranslationCache';
import { defaultSettings } from '../src/storage/settings';
import { AppError } from '../src/utils/errors';
const context = {
  site: 'miruro' as const,
  title: 'Test',
  episode: 1,
  pageUrl: 'https://www.miruro.to/watch/test?ep=1',
};
const cues = Array.from({ length: 5 }, (_, i) => ({
  id: i + 1,
  startTime: i * 2,
  endTime: i * 2 + 1,
  text: 'line ' + i,
}));
describe('translation invariants', () => {
  it('chunks on both count and character limits', () => {
    expect(chunkCues(cues, 2, 100).map((x) => x.length)).toEqual([2, 2, 1]);
    expect(chunkCues(cues, 60, 7).map((x) => x.length)).toEqual([1, 1, 1, 1, 1]);
  });
  it('rejects missing, duplicate, extra and blank ids', () => {
    for (const r of [
      [{ id: 1, text: 'a' }],
      [
        { id: 1, text: 'a' },
        { id: 1, text: 'b' },
      ],
      [
        { id: 1, text: 'a' },
        { id: 3, text: 'b' },
      ],
      [
        { id: 1, text: ' ' },
        { id: 2, text: 'b' },
      ],
    ])
      expect(() => validateTranslations(cues.slice(0, 2), r)).toThrow();
  });
  it('keeps times, excludes timecodes from requests, retries only failed chunk and reuses IndexedDB cache', async () => {
    let failure = true;
    const fn = vi.fn(async (input, opts) => {
      expect(input.every((x: object) => !('startTime' in x))).toBe(true);
      if (input[0].id === 3 && failure) {
        failure = false;
        throw new AppError('TRANSLATION_FORMAT', 'invalid', true);
      }
      if (input[0].id === 3)
        expect(opts.previousContext.map((x: { id: number }) => x.id)).toEqual([1, 2]);
      return input.map((x: { id: number }) => ({ id: x.id, text: '한국어 ' + x.id }));
    });
    const cache = new TranslationCache();
    const manager = new TranslationManager(
      { id: 'mock', translate: fn },
      { ...defaultSettings.translation, model: 'mock-' + Date.now(), chunkSize: 2 },
      cache,
    );
    const out = await manager.translate(cues, context, 'en', () => {});
    expect(out.map((c) => [c.startTime, c.endTime])).toEqual(
      cues.map((c) => [c.startTime, c.endTime]),
    );
    expect(fn).toHaveBeenCalledTimes(4);
    const reopened = new TranslationManager(
      { id: 'mock', translate: fn },
      { ...defaultSettings.translation, model: manager['config'].model, chunkSize: 2 },
      new TranslationCache(),
    );
    await reopened.translate(cues, context, 'en', () => {});
    expect(fn).toHaveBeenCalledTimes(4);
  });
});
