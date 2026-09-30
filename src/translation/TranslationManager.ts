import type { SubtitleCue } from '../subtitle/SubtitleCue';
import type { AnimeContext } from '../anime/AnimeContext';
import type { Settings } from '../storage/settings';
import type { TranslationProvider, TranslationCue, TranslatedCue } from './TranslationProvider';
import { validateTranslations } from './TranslationProvider';
import { TranslationCache, translationKey, type TranslationStore } from './TranslationCache';
import { subtitleHash } from '../subtitle/SubtitleCache';
import { retry } from '../utils/retry';
import { AppError } from '../utils/errors';
import { log } from '../utils/logger';
export function chunkCues(
  cues: SubtitleCue[],
  maxCount: number,
  maxCharacters: number,
): SubtitleCue[][] {
  if (maxCount < 1 || maxCharacters < 1) throw new AppError('CONFIG', 'Chunk 설정을 확인하세요.');
  const chunks: SubtitleCue[][] = [];
  let chunk: SubtitleCue[] = [],
    chars = 0;
  for (const cue of cues) {
    if (cue.text.length > maxCharacters)
      throw new AppError('SIZE', '한 자막이 최대 문자 수를 초과합니다. 원본 자막을 확인하세요.');
    if (chunk.length && (chunk.length >= maxCount || chars + cue.text.length > maxCharacters)) {
      chunks.push(chunk);
      chunk = [];
      chars = 0;
    }
    chunk.push(cue);
    chars += cue.text.length;
  }
  if (chunk.length) chunks.push(chunk);
  return chunks;
}
export class TranslationManager {
  constructor(
    private provider: TranslationProvider,
    private config: Settings['translation'],
    private cache: TranslationStore = new TranslationCache(),
  ) {}
  async translate(
    cues: SubtitleCue[],
    context: AnimeContext,
    language: 'ja' | 'en',
    onProgress: (done: number, total: number, cached?: boolean) => void,
    signal?: AbortSignal,
  ): Promise<SubtitleCue[]> {
    if (new Set(cues.map((c) => c.id)).size !== cues.length)
      throw new AppError('ID', '원본 자막 ID가 중복됩니다.');
    const key = await translationKey(context, JSON.stringify(cues), language, this.config);
    const cached = await this.cache.get<TranslatedCue[]>(key);
    if (cached) {
      const translated = validateTranslations(cues, cached);
      onProgress(1, 1, true);
      return cues.map((c, i) => ({ ...c, text: translated[i].text }));
    }
    const chunks = chunkCues(cues, this.config.chunkSize, this.config.maxCharacters);
    const output: TranslatedCue[] = [];
    let index = 0;
    for (let i = 0; i < chunks.length; i++) {
      signal?.throwIfAborted();
      const input = chunks[i].map(({ id, text }): TranslationCue => ({ id, text }));
      const previousContext = cues
        .slice(Math.max(0, index - this.config.contextCues), index)
        .map(({ id, text }) => ({ id, text }));
      const previousTranslations = output.slice(
        Math.max(0, output.length - this.config.contextCues),
      );
      const partKey =
        key +
        ':chunk:' +
        (await subtitleHash(JSON.stringify({ input, previousContext, previousTranslations })));
      onProgress(i, chunks.length);
      let part = await this.cache.get<TranslatedCue[]>(partKey);
      if (part) part = validateTranslations(input, part);
      else {
        part = await retry(
          async () => {
            const raw = await this.provider.translate(input, {
              sourceLanguage: language,
              previousContext,
              previousTranslations,
              signal,
            });
            try {
              return validateTranslations(input, raw);
            } catch {
              throw new AppError('TRANSLATION_FORMAT', '번역 응답 형식이 잘못되었습니다.', true);
            }
          },
          this.config.maxRetry,
          signal,
          (e) => e instanceof AppError && e.retryable,
        );
        signal?.throwIfAborted();
        await this.cache.put(partKey, part);
      }
      output.push(...part);
      index += input.length;
      log('Translation', {
        chunk: i + 1,
        total: chunks.length,
        inputCues: input.length,
        outputCues: part.length,
      });
      onProgress(i + 1, chunks.length);
    }
    const verified = validateTranslations(cues, output);
    await this.cache.put(key, verified);
    return cues.map((cue, i) => ({ ...cue, text: verified[i].text }));
  }
}
