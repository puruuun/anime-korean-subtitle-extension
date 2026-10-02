import { database } from '../storage/database';
import { episodeKey, type AnimeContext } from '../anime/AnimeContext';
import type { Settings } from '../storage/settings';
import type { SubtitleCue } from './SubtitleCue';
import type { TranslationBufferStatus } from '../translation/TranslationQueue';
import { PROMPT_VERSION } from '../translation/prompts';
export interface EpisodeSnapshot {
  context: AnimeContext;
  cues: SubtitleCue[];
  originalCues?: SubtitleCue[];
  language: 'ko' | 'ja' | 'en';
  source: string;
  path?: string;
  translation?: TranslationBufferStatus;
  complete: boolean;
  expiresAt: number;
}
export function episodeCacheKey(c: AnimeContext, s: Settings, mode: Settings['mode']) {
  const t = s.translation;
  return JSON.stringify([
    'episode:v1',
    episodeKey(c),
    mode,
    s.autoSources,
    t.provider,
    t.provider === 'gemini' ? t.geminiModel : t.model,
    t.provider === 'gemini' ? 'gemini' : t.baseUrl,
    t.chunkSize,
    t.initialChunkSize,
    t.maxCharacters,
    t.contextCues,
    t.temperature,
    PROMPT_VERSION,
  ]);
}
export class EpisodeCache {
  async get(key: string) {
    const value = await database.get<EpisodeSnapshot>(key).catch(() => undefined);
    return value && value.expiresAt > Date.now() && value.cues.length && value.source
      ? value
      : undefined;
  }
  put(key: string, value: Omit<EpisodeSnapshot, 'expiresAt'>) {
    return database.put(key, { ...value, expiresAt: Date.now() + 86400000 }).catch(() => {});
  }
}
