import type { SubtitleSource } from '../sites/types';
import type { AnimeContext } from '../anime/AnimeContext';
import type { Settings } from '../storage/settings';
import type { SubtitleCue } from './SubtitleCue';
import type { SubtitleSearchResult, SubtitleProvider } from '../providers/SubtitleProvider';
import { TranslationQueue, type TranslationBufferStatus } from '../translation/TranslationQueue';
import { createTranslationProvider } from '../translation/createTranslationProvider';
import {
  languageLabel,
  normalizeTargetLanguage,
  sameBaseLanguage,
} from '../translation/languages';
import { AppError } from '../utils/errors';
import { SubtitlePipeline, type Mode, type PipelineResult } from './SubtitlePipeline';
export { SelectionRequired } from './SubtitleSelection';
export type { Mode } from './SubtitlePipeline';
export interface CoreStatus {
  stage: string;
  message: string;
  results?: SubtitleSearchResult[];
  path?: string;
  source?: string;
  progress?: { done: number; total: number };
  warnings?: string[];
  translation?: TranslationBufferStatus;
}
export interface ProgressiveHooks {
  onSource?: (result: PipelineResult) => void | Promise<void>;
  onStart: (
    cues: SubtitleCue[],
    language: string,
    queue: TranslationQueue,
  ) => void | Promise<void>;
  onChunk: (cues: SubtitleCue[], snapshot: TranslationBufferStatus) => void | Promise<void>;
}
export class SubtitleCore {
  protected source = '';
  constructor(
    protected providers: SubtitleProvider[],
    protected settings: Settings,
    protected status: (s: CoreStatus) => void,
    protected signal: AbortSignal,
    protected embedded?: () => Promise<SubtitleSource[]>,
    protected progressive?: ProgressiveHooks,
  ) {}
  protected async translate(cues: SubtitleCue[], c: AnimeContext, language: string) {
    this.signal.throwIfAborted();
    if (
      this.settings.translation.provider === 'gemini'
        ? !this.settings.translation.geminiModel.trim() ||
          !this.settings.translation.geminiApiKey.trim()
        : !this.settings.translation.model.trim()
    )
      throw new AppError(
        'CONFIG',
        'Settings에서 선택한 번역 엔진의 모델과 연결 정보를 입력하세요.',
      );
    const provider = createTranslationProvider(this.settings.translation);
    const queue = new TranslationQueue(provider, this.settings.translation);
    const targetLanguage = normalizeTargetLanguage(this.settings.targetLanguage);
    const targetLabel = languageLabel(targetLanguage);
    await this.progressive?.onStart(cues, language, queue);
    this.signal.throwIfAborted();
    const engine = provider.id === 'gemini' ? 'Gemini' : 'Local LLM';
    const contentKind = c.site === 'generic' ? 'general' : 'anime';
    return queue.run(
      cues,
      c,
      language,
      {
        onChunk: async (delta, snapshot) => {
          this.signal.throwIfAborted();
          await this.progressive?.onChunk(delta, snapshot);
        },
        onState: (snapshot) =>
          this.status({
            stage: 'translate',
            message:
              languageLabel(language) +
              ' → ' +
              targetLabel +
              ' 번역 중 ' +
              snapshot.completedChunks +
              ' / ' +
              snapshot.totalChunks,
            progress: { done: snapshot.completedChunks, total: snapshot.totalChunks },
            path:
              (this.source === 'embedded-generic'
                ? 'Embedded Video'
                : this.source === 'embedded-en'
                  ? 'Embedded English'
                  : this.source === 'jimaku'
                    ? 'Jimaku'
                    : this.source === 'kitsunekko'
                      ? 'Kitsunekko'
                      : this.source === 'anissia'
                        ? 'Anissia'
                        : 'Web Search (KO)') +
              ' → ' +
              engine,
            source: this.source,
            translation: snapshot,
          }),
      },
      this.signal,
      this.source,
      targetLanguage,
      contentKind,
    );
  }
  async run(
    c: AnimeContext,
    mode: Mode,
    selected?: SubtitleSearchResult,
    cachedSource?: PipelineResult,
  ): Promise<SubtitleCue[]> {
    const result =
      cachedSource ??
      (await new SubtitlePipeline(
        this.providers,
        this.settings,
        this.status,
        this.signal,
        this.embedded,
      ).resolve(c, mode, selected));
    this.signal.throwIfAborted();
    this.source = result.source;
    await this.progressive?.onSource?.(result);
    this.signal.throwIfAborted();
    const targetLanguage = normalizeTargetLanguage(this.settings.targetLanguage);
    if (sameBaseLanguage(result.language, targetLanguage)) {
      const path =
        result.source === 'embedded-generic'
          ? 'Embedded Video'
          : result.source === 'web-ko'
            ? 'Web Search (KO)'
            : result.source === 'anissia'
              ? 'Anissia'
              : result.source === 'embedded-en'
                ? 'Embedded English'
                : result.source === 'jimaku'
                  ? 'Jimaku'
                  : 'Kitsunekko';
      const message =
        result.language === 'ko'
          ? result.source === 'web-ko'
            ? '웹 한국어 자막 사용 중'
            : result.source === 'embedded-generic'
              ? '웹 영상 한국어 내장 자막 사용 중'
              : 'Anissia 한국어 자막 사용 중'
          : `${languageLabel(targetLanguage)} 자막 사용 중`;
      this.status({
        stage: 'source',
        message,
        path,
        source: result.source,
      });
      return result.cues;
    }
    return this.translate(result.cues, c, result.language);
  }
}
