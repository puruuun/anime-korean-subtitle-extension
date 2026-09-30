import { defaultDisplay, type DisplaySettings } from '../subtitle/SubtitleRenderer';
export interface Settings {
  mode: 'ko' | 'ja' | 'en' | 'auto';
  translation: {
    provider: 'lmstudio' | 'openai';
    baseUrl: string;
    apiKey: string;
    model: string;
    chunkSize: number;
    maxCharacters: number;
    contextCues: number;
    temperature: number;
    timeoutMs: number;
    maxRetry: number;
    structured: 'json_schema' | 'json_object' | 'none';
  };
  providers: {
    subdl: { enabled: boolean; apiKey: string; priority: number };
    opensubtitles: {
      enabled: boolean;
      apiKey: string;
      token: string;
      username: string;
      password: string;
      baseUrl: string;
      priority: number;
    };
  };
  display: DisplaySettings;
  debug: boolean;
}
export const defaultSettings: Settings = {
  mode: 'ko',
  translation: {
    provider: 'lmstudio',
    baseUrl: 'http://127.0.0.1:1234/v1',
    apiKey: '',
    model: '',
    chunkSize: 45,
    maxCharacters: 5000,
    contextCues: 5,
    temperature: 0.2,
    timeoutMs: 120000,
    maxRetry: 2,
    structured: 'json_schema',
  },
  providers: {
    subdl: { enabled: true, apiKey: '', priority: 1 },
    opensubtitles: {
      enabled: true,
      apiKey: '',
      token: '',
      username: '',
      password: '',
      baseUrl: 'https://api.opensubtitles.com/api/v1',
      priority: 2,
    },
  },
  display: defaultDisplay,
  debug: false,
};
export async function getSettings(): Promise<Settings> {
  const stored = await chrome.storage.local.get('settings');
  const settings = stored.settings as Partial<Settings> | undefined;
  return settings
    ? {
        ...defaultSettings,
        ...settings,
        translation: { ...defaultSettings.translation, ...settings.translation },
        providers: {
          subdl: { ...defaultSettings.providers.subdl, ...settings.providers?.subdl },
          opensubtitles: {
            ...defaultSettings.providers.opensubtitles,
            ...settings.providers?.opensubtitles,
          },
        },
        display: { ...defaultDisplay, ...settings.display },
      }
    : structuredClone(defaultSettings);
}
export function validateSettings(s: Settings) {
  const u = new URL(s.translation.baseUrl);
  if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password || u.search || u.hash)
    throw Error('Base URL 형식을 확인하세요.');
  const t = s.translation;
  if (
    Object.values({
      chunkSize: t.chunkSize,
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
  validateSettings(s);
  await chrome.storage.local.set({ settings: s });
}
