import type { SubtitleSource } from '../sites/types';
import type { AnimeContext } from '../anime/AnimeContext';
import type { Settings } from '../storage/settings';
import type { SubtitleCue } from './SubtitleCue';
import type { SubtitleSearchResult, SubtitleProvider } from '../providers/SubtitleProvider';
import { TranslationQueue, type TranslationBufferStatus } from '../translation/TranslationQueue';
import { createTranslationProvider } from '../translation/createTranslationProvider';
import { AppError } from '../utils/errors';
import { SubtitlePipeline, type Mode } from './SubtitlePipeline';
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
  onStart: (
    cues: SubtitleCue[],
    language: 'ja' | 'en',
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
  protected async translate(cues: SubtitleCue[], c: AnimeContext, language: 'ja' | 'en') {
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
    await this.progressive?.onStart(cues, language, queue);
    this.signal.throwIfAborted();
    const engine = provider.id === 'gemini' ? 'Gemini' : 'Local LLM';
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
              (language === 'ja' ? '일본어' : '영어') +
              ' → 한국어 번역 중 ' +
              snapshot.completedChunks +
              ' / ' +
              snapshot.totalChunks,
            progress: { done: snapshot.completedChunks, total: snapshot.totalChunks },
            path:
              (this.source === 'embedded-en'
                ? 'Embedded English'
                : this.source === 'jimaku'
                  ? 'Jimaku'
                  : 'Kitsunekko') +
              ' → ' +
              engine,
            source: this.source,
            translation: snapshot,
          }),
      },
      this.signal,
      this.source,
    );
  }
  async run(c: AnimeContext, mode: Mode, selected?: SubtitleSearchResult): Promise<SubtitleCue[]> {
    const result = await new SubtitlePipeline(
      this.providers,
      this.settings,
      this.status,
      this.signal,
      this.embedded,
    ).resolve(c, mode, selected);
    this.signal.throwIfAborted();
    this.source = result.source;
    if (result.language === 'ko') {
      this.status({
        stage: 'source',
        message: 'Anissia 한국어 자막 사용 중',
        path: 'Anissia',
        source: result.source,
      });
      return result.cues;
    }
    return this.translate(result.cues, c, result.language);
  }
}
