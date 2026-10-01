import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  defaultSettings,
  getSettings,
  saveSettings,
  validateSettings,
  type Settings,
} from '../src/storage/settings';

afterEach(() => vi.unstubAllGlobals());

describe('progressive translation settings', () => {
  it('adds progressive defaults to a stored pre-progressive configuration without losing server or display settings', async () => {
    const legacy = structuredClone(defaultSettings) as Settings;
    const translation = legacy.translation as Partial<Settings['translation']>;
    delete translation.initialChunkSize;
    delete translation.targetBufferSeconds;
    delete translation.immediatePlayback;
    legacy.translation.model = 'local-loaded-model';
    legacy.translation.baseUrl = 'http://localhost:5555/v1';
    legacy.display.fontSize = 36;
    const set = vi.fn();
    vi.stubGlobal('chrome', {
      storage: { local: { get: vi.fn(async () => ({ settings: legacy })), set } },
    });
    const settings = await getSettings();
    expect(settings.translation).toMatchObject({
      model: 'local-loaded-model',
      baseUrl: 'http://localhost:5555/v1',
      initialChunkSize: 20,
      targetBufferSeconds: 300,
      immediatePlayback: false,
    });
    expect(settings.display.fontSize).toBe(36);
    expect(() => validateSettings(legacy)).not.toThrow();
    await saveSettings(legacy);
    expect(set).toHaveBeenCalledWith({ settings });
  });

  it('accepts the initial cue limits and configurable buffer limits', () => {
    for (const [initialChunkSize, targetBufferSeconds] of [
      [15, 60],
      [25, 1800],
    ]) {
      const settings = structuredClone(defaultSettings);
      Object.assign(settings.translation, {
        initialChunkSize,
        targetBufferSeconds,
        immediatePlayback: true,
      });
      expect(() => validateSettings(settings)).not.toThrow();
    }
  });

  it('rejects out of range, noninteger and invalid boolean progressive values before saving', async () => {
    const set = vi.fn();
    vi.stubGlobal('chrome', { storage: { local: { set } } });
    for (const invalid of [
      { initialChunkSize: 14 },
      { initialChunkSize: 26 },
      { initialChunkSize: 20.5 },
      { initialChunkSize: Number.NaN },
      { targetBufferSeconds: 59 },
      { targetBufferSeconds: 1801 },
      { targetBufferSeconds: 300.5 },
      { targetBufferSeconds: Number.POSITIVE_INFINITY },
      { immediatePlayback: 'true' },
    ]) {
      const settings = structuredClone(defaultSettings);
      Object.assign(settings.translation, invalid);
      await expect(saveSettings(settings)).rejects.toThrow('설정');
    }
    expect(set).not.toHaveBeenCalled();
  });
});

describe('source settings migration', () => {
  it('J: cleans obsolete provider keys/credentials once, keeps local translation and display, starts in AUTO', async () => {
    let raw: Record<string, unknown> = {
      mode: 'ko',
      providers: { retiredA: { apiKey: 'old-key' }, retiredB: { password: 'old-password' } },
      translation: { model: 'my-local-model' },
      display: { fontSize: 40 },
    };
    const set = vi.fn(async (value: { settings: Settings }) => {
      raw = value.settings as unknown as Record<string, unknown>;
    });
    vi.stubGlobal('chrome', { storage: { local: { get: async () => ({ settings: raw }), set } } });
    const current = await getSettings();
    expect(current.mode).toBe('auto');
    expect(current.schemaVersion).toBe(2);
    expect(current.autoSources).toEqual({
      anissia: true,
      japaneseTranslation: true,
      embeddedEnglish: true,
    });
    expect(current.translation.model).toBe('my-local-model');
    expect(current.display.fontSize).toBe(40);
    expect(JSON.stringify(current)).not.toContain('old-key');
    expect(current).not.toHaveProperty('providers');
    await getSettings();
    expect(set).toHaveBeenCalledOnce();
  });
  it('keeps previous Japanese/English modes as manual modes, resets unknown IDs without crashes', async () => {
    for (const mode of ['ja', 'en', 'removed-provider']) {
      vi.stubGlobal('chrome', {
        storage: { local: { get: async () => ({ settings: { mode } }), set: vi.fn() } },
      });
      expect((await getSettings()).mode).toBe(mode === 'removed-provider' ? 'auto' : mode);
    }
  });
});
