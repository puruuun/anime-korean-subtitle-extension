import { defaultDisplay, type DisplaySettings } from '../subtitle/SubtitleRenderer';
export interface Settings {
  schemaVersion: 2;
  autoSources: { anissia: boolean; japaneseTranslation: boolean; embeddedEnglish: boolean };
  jimaku: { apiKey: string };
  mode: 'ko' | 'ja' | 'en' | 'auto';
  autoApply: boolean;
  translation: {
    provider: 'lmstudio' | 'gemini';
    geminiApiKey: string;
    geminiModel: string;
    baseUrl: string;
    apiKey: string;
    model: string;
    chunkSize: number;
    initialChunkSize: number;
    targetBufferSeconds: number;
    immediatePlayback: boolean;
    maxCharacters: number;
    contextCues: number;
    temperature: number;
    timeoutMs: number;
    maxRetry: number;
    structured: 'json_schema' | 'json_object' | 'none';
  };
  display: DisplaySettings;
  debug: boolean;
}
export const defaultSettings: Settings = {
  schemaVersion: 2,
  mode: 'auto',
  autoApply: true,
  autoSources: { anissia: true, japaneseTranslation: true, embeddedEnglish: true },
  jimaku: { apiKey: '' },
  translation: {
    provider: 'lmstudio',
    geminiApiKey: '',
    geminiModel: '',
    baseUrl: 'http://127.0.0.1:1234/v1',
    apiKey: '',
    model: '',
    chunkSize: 45,
    initialChunkSize: 20,
    targetBufferSeconds: 300,
    immediatePlayback: false,
    maxCharacters: 5000,
    contextCues: 5,
    temperature: 0.2,
    timeoutMs: 120000,
    maxRetry: 2,
    structured: 'json_schema',
  },
  display: defaultDisplay,
  debug: false,
};
// Rebuild from an allowlist so retired provider credentials and unknown settings are discarded.
function known<T extends object>(defaults: T, input?: Partial<T>): T {
  return Object.fromEntries(
    Object.entries(defaults).map(([key, value]) => [key, input?.[key as keyof T] ?? value]),
  ) as T;
}
export function normalizeSettings(settings?: Partial<Settings>): Settings {
  const translation = known(defaultSettings.translation, settings?.translation);
  if (!['lmstudio', 'gemini'].includes(translation.provider))
    translation.provider = defaultSettings.translation.provider;
  const mode = settings?.mode;
  return {
    schemaVersion: 2,
    autoApply: settings?.autoApply !== false,
    mode:
      mode && ['auto', 'ko', 'ja', 'en'].includes(mode)
        ? settings?.schemaVersion !== 2 && mode === 'ko'
          ? 'auto'
          : mode
        : 'auto',
    autoSources: known(defaultSettings.autoSources, settings?.autoSources),
    jimaku: known(defaultSettings.jimaku, settings?.jimaku),
    translation,
    display: known(defaultDisplay, settings?.display),
    debug: settings?.debug === true,
  };
}
export async function getSettings(): Promise<Settings> {
  const stored = await chrome.storage.local.get('settings');
  const settings = normalizeSettings(stored.settings as Partial<Settings> | undefined);
  if (stored.settings && JSON.stringify(stored.settings) !== JSON.stringify(settings))
    await chrome.storage.local.set({ settings });
  return settings;
}
export function validateSettings(s: Settings) {
  if (
    !['auto', 'ko', 'ja', 'en'].includes(s.mode) ||
    typeof s.autoApply !== 'boolean' ||
    Object.values(s.autoSources).some((v) => typeof v !== 'boolean') ||
    typeof s.jimaku.apiKey !== 'string'
  )
    throw Error('자막 설정을 확인하세요.');
  const u = new URL(s.translation.baseUrl);
  if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password || u.search || u.hash)
    throw Error('Base URL 형식을 확인하세요.');
  const t = { ...defaultSettings.translation, ...s.translation };
  if (
    Object.values({
      chunkSize: t.chunkSize,
      initialChunkSize: t.initialChunkSize,
      targetBufferSeconds: t.targetBufferSeconds,
      maxCharacters: t.maxCharacters,
      contextCues: t.contextCues,
      temperature: t.temperature,
      timeoutMs: t.timeoutMs,
      maxRetry: t.maxRetry,
      ...s.display,
    }).some((v) => !Number.isFinite(v))
  )
    throw Error('숫자 설정을 확인하세요.');
  if (
    !Number.isInteger(t.chunkSize) ||
    t.chunkSize < 1 ||
    t.chunkSize > 60 ||
    !Number.isInteger(t.initialChunkSize) ||
    t.initialChunkSize < 15 ||
    t.initialChunkSize > 25 ||
    !Number.isInteger(t.targetBufferSeconds) ||
    t.targetBufferSeconds < 60 ||
    t.targetBufferSeconds > 1800 ||
    typeof t.immediatePlayback !== 'boolean' ||
    t.maxCharacters < 100 ||
    t.maxCharacters > 6000 ||
    t.contextCues < 0 ||
    t.contextCues > 20 ||
    t.temperature < 0 ||
    t.temperature > 2 ||
    t.timeoutMs < 1000 ||
    t.timeoutMs > 240000 ||
    t.maxRetry < 0 ||
    t.maxRetry > 5
  )
    throw Error('번역 설정 범위를 확인하세요.');
  if (
    s.display.fontSize < 12 ||
    s.display.fontSize > 72 ||
    s.display.bottom < 0 ||
    s.display.bottom > 50 ||
    s.display.backgroundOpacity < 0 ||
    s.display.backgroundOpacity > 1 ||
    s.display.outline < 0 ||
    s.display.outline > 6 ||
    s.display.maxLines < 1 ||
    s.display.maxLines > 8
  )
    throw Error('자막 표시 설정 범위를 확인하세요.');
}
export async function saveSettings(s: Settings) {
  const settings = normalizeSettings(s);
  validateSettings(settings);
  await chrome.storage.local.set({ settings });
}
