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
) {
  return subtitleHash(
    JSON.stringify({
      context: contextKey(c),
      sourceHash: await subtitleHash(source),
      sourceLanguage: language,
      targetLanguage: 'ko',
      provider: s.provider,
      endpoint: s.baseUrl,
      model: s.model,
      prompt: PROMPT_VERSION,
      temperature: s.temperature,
      chunkSize: s.chunkSize,
      maxCharacters: s.maxCharacters,
      contextCues: s.contextCues,
    }),
  );
}
