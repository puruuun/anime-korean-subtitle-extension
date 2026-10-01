import { database } from '../storage/database';
import { contextKey, type AnimeContext } from '../anime/AnimeContext';
import { subtitleHash } from '../subtitle/SubtitleCache';
import type { Settings } from '../storage/settings';
import { PROMPT_VERSION } from './prompts';
export interface TranslationStore {
  get<T>(key: string): Promise<T | undefined>;
  put<T>(key: string, value: T): Promise<void>;
}
export class TranslationCache implements TranslationStore {
  get<T>(key: string) {
    return database.get<T>('translation:' + key);
  }
  put<T>(key: string, value: T) {
    return database.put('translation:' + key, value);
  }
}
export async function translationKey(
  c: AnimeContext,
  source: string,
  language: 'ja' | 'en',
  s: Settings['translation'],
  sourceId = language === 'en' ? 'embedded-en' : 'external-ja',
) {
  return subtitleHash(
    JSON.stringify({
      context: contextKey(c),
      sourceHash: await subtitleHash(source),
      sourceLanguage: language,
      sourceId,
      targetLanguage: 'ko',
      provider: s.provider,
      endpoint:
        s.provider === 'gemini' ? 'https://generativelanguage.googleapis.com/v1beta' : s.baseUrl,
      model: s.provider === 'gemini' ? s.geminiModel : s.model,
      prompt: PROMPT_VERSION,
      temperature: s.temperature,
      chunkSize: s.chunkSize,
      maxCharacters: s.maxCharacters,
      contextCues: s.contextCues,
    }),
  );
}
