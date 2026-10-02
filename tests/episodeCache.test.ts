import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { database } from '../src/storage/database';
import { EpisodeCache, episodeCacheKey } from '../src/subtitle/EpisodeCache';
import { defaultSettings } from '../src/storage/settings';
const context = {
  site: 'miruro' as const,
  title: 'Show',
  episode: 7,
  pageUrl: 'https://www.miruro.to/watch/154587/show?ep=7',
};
const cues = [{ id: 1, startTime: 1, endTime: 5, text: '한국어' }];
beforeEach(() => database.clear());
describe('cache before network search', () => {
  it('retains a complete Korean episode and a resumable partial translation source', async () => {
    const cache = new EpisodeCache(),
      key = episodeCacheKey(context, defaultSettings, 'auto');
    await cache.put(key, { context, cues, language: 'ko', source: 'anissia', complete: true });
    expect(await cache.get(key)).toMatchObject({ cues, complete: true, source: 'anissia' });
    await cache.put(key, {
      context,
      cues,
      language: 'ja',
      source: 'jimaku',
      complete: false,
      originalCues: [{ ...cues[0], text: '日本語' }],
    });
    expect(await cache.get(key)).toMatchObject({
      complete: false,
      originalCues: [{ text: '日本語' }],
    });
  });
  it('separates episode, language mode, source preferences, endpoint, model and prompt settings', () => {
    const key = episodeCacheKey(context, defaultSettings, 'auto');
    expect(episodeCacheKey({ ...context, episode: 8 }, defaultSettings, 'auto')).not.toBe(key);
    expect(episodeCacheKey(context, defaultSettings, 'ja')).not.toBe(key);
    const changed = structuredClone(defaultSettings);
    changed.translation.model = 'new-model';
    expect(episodeCacheKey(context, changed, 'auto')).not.toBe(key);
    changed.translation.model = '';
    changed.autoSources.anissia = false;
    expect(episodeCacheKey(context, changed, 'auto')).not.toBe(key);
  });
  it('expires old entries and allows the normal search path to resume', async () => {
    const key = episodeCacheKey(context, defaultSettings, 'auto');
    await database.put(key, {
      context,
      cues,
      language: 'ko',
      source: 'anissia',
      complete: true,
      expiresAt: Date.now() - 1,
    });
    expect(await new EpisodeCache().get(key)).toBeUndefined();
  });
});
