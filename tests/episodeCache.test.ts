import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { database } from '../src/storage/database';
import { EpisodeCache, episodeCacheKey } from '../src/subtitle/EpisodeCache';
import { SubtitleCache } from '../src/subtitle/SubtitleCache';
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
    expect(await database.get(key)).toBeUndefined();
  });

  it('deletes expired SubtitleCache entry on get', async () => {
    const cache = new SubtitleCache();
    const key = 'test-sub-hash';
    await database.put('download:' + key, {
      data: new ArrayBuffer(8),
      at: Date.now() - 86400000 - 1000,
    });
    expect(await cache.get(key)).toBeUndefined();
    expect(await database.get('download:' + key)).toBeUndefined();
  });

  describe('database.prune', () => {
    it('prunes expired entries by expiresAt or at (24 hours) and trims excess entries beyond maxEntries', async () => {
      const now = Date.now();
      // 1. Expired by expiresAt
      await database.put('exp1', { expiresAt: now - 10 });
      // 2. Expired by at >= 24h
      await database.put('exp2', { at: now - 86400000 });
      // 3. Valid entry 1
      await database.put('valid1', { expiresAt: now + 10000 });
      // 4. Valid entry 2
      await database.put('valid2', { at: now - 1000 });
      // 5. Valid entry 3
      await database.put('valid3', { expiresAt: now + 20000 });

      // Total 5 entries: 2 expired, 3 valid.
      // If maxEntries is 2, 2 expired + 1 excess valid = 3 pruned.
      const pruned = await database.prune(now, 2);
      expect(pruned).toBe(3);

      expect(await database.get('exp1')).toBeUndefined();
      expect(await database.get('exp2')).toBeUndefined();

      // Check valid entries: exactly 2 should remain
      const v1 = await database.get('valid1');
      const v2 = await database.get('valid2');
      const v3 = await database.get('valid3');
      const remainingValid = [v1, v2, v3].filter((x) => x !== undefined);
      expect(remainingValid).toHaveLength(2);
    });
  });
});
