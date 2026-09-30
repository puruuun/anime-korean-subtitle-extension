import { autoMode } from './AutoMode';
import type { SubtitleSource } from '../sites/types';
import { loadEmbeddedSource } from './EmbeddedSubtitleLoader';
import type { AnimeContext } from '../anime/AnimeContext';
import type { Settings } from '../storage/settings';
import type { SubtitleCue } from './SubtitleCue';
import type {
  SourceLanguage,
  SubtitleSearchResult,
  SubtitleProvider,
} from '../providers/SubtitleProvider';
import { SubtitleSearch } from './SubtitleSearch';
import { SubtitleCache } from './SubtitleCache';
import { extractSubtitle } from './archive';
import { decodeSubtitle } from '../utils/encoding';
import { parseSubtitle } from './SubtitleParser';
import { AppError } from '../utils/errors';
import { TranslationManager } from '../translation/TranslationManager';
import { LMStudioProvider } from '../translation/lmstudio/LMStudioProvider';
import { OpenAICompatibleProvider } from '../translation/openaiCompatible/OpenAICompatibleProvider';
export type Mode = 'ko' | 'ja' | 'en' | 'auto';
export interface CoreStatus {
  stage: string;
  message: string;
  results?: SubtitleSearchResult[];
  path?: string;
  progress?: { done: number; total: number };
  warnings?: string[];
}
export class SelectionRequired extends AppError {
  constructor(
    public results: SubtitleSearchResult[],
    public language: SourceLanguage,
  ) {
    super('SELECT', '자막 후보를 직접 선택하세요. 회차와 시즌을 확인하세요.');
  }
}
export class SubtitleCore {
  constructor(
    protected providers: SubtitleProvider[],
    protected settings: Settings,
    protected status: (s: CoreStatus) => void,
    protected signal: AbortSignal,
    protected embedded?: () => Promise<SubtitleSource[]>,
  ) {}
  protected async english(c: AnimeContext) {
    this.status({ stage: 'extract', message: '사이트 영문 자막 추출 중...' });
    const sources = await this.embedded?.();
    if (!sources?.length)
      throw new AppError(
        'EN_NOT_FOUND',
        '영문 자막을 찾지 못했습니다. 플레이어에서 English 자막을 선택하고 권한을 확인하세요.',
      );
    let last: unknown;
    for (const source of sources) {
      let cues: SubtitleCue[];
      try {
        cues = await loadEmbeddedSource(source, this.signal);
      } catch (e) {
        this.signal.throwIfAborted();
        last = e;
        continue;
      }
      return this.translate(cues, c, 'en');
    }
    throw last ?? new AppError('EN_NOT_FOUND', '영문 자막을 찾지 못했습니다.');
  }
  protected async external(
    c: AnimeContext,
    language: SourceLanguage,
    selected?: SubtitleSearchResult,
  ): Promise<SubtitleCue[]> {
    if (!this.providers.length)
      throw new AppError('CONFIG', 'Settings에서 자막 Provider API Key를 입력하세요.');
    let result = selected;
    if (!result) {
      this.status({
        stage: 'search',
        message: language === 'ko' ? '한국어 자막 검색 중...' : '일본어 자막 검색 중...',
      });
      const found = await new SubtitleSearch(this.providers).search(c, language, this.signal);
      if (!found.results.length)
        throw new AppError(
          'NOT_FOUND',
          language === 'ko' ? '한국어 자막을 찾을 수 없습니다.' : '일본어 자막을 찾을 수 없습니다.',
        );
      const top = found.results[0];
      const second = found.results[1];
      if (
        !top.autoEligible ||
        (second &&
          second.autoEligible &&
          top.providerId === second.providerId &&
          (top.score ?? 0) - (second.score ?? 0) < 10)
      )
        throw new SelectionRequired(found.results, language);
      result = top;
    }
    this.signal.throwIfAborted();
    const provider = this.providers.find((p) => p.id === result!.providerId);
    if (!provider) throw new AppError('PROVIDER', '선택한 Provider가 비활성화되었습니다.');
    this.status({
      stage: 'download',
      message: '자막 다운로드 중...',
      path: language === 'ko' ? '한국어 자막' : '일본어 → 한국어',
    });
    const cache = new SubtitleCache();
    let buffer = await cache.get(result.id);
    if (!buffer) {
      buffer = await provider.download(result);
      this.signal.throwIfAborted();
      await cache.put(result.id, buffer);
    }
    const { bytes, name } = extractSubtitle(buffer, c.episode);
    return parseSubtitle(decodeSubtitle(bytes, language), name.split('.').at(-1));
  }
  protected translate(cues: SubtitleCue[], c: AnimeContext, language: 'ja' | 'en') {
    const provider =
      this.settings.translation.provider === 'lmstudio'
        ? new LMStudioProvider(this.settings.translation)
        : new OpenAICompatibleProvider(this.settings.translation);
    return new TranslationManager(provider, this.settings.translation).translate(
      cues,
      c,
      language,
      (done, total, cached) =>
        this.status({
          stage: 'translate',
          message: cached ? '번역 캐시 사용' : '번역 ' + done + ' / ' + total,
          progress: { done, total },
          path: language === 'ja' ? '일본어 → 한국어' : '영어 → 한국어',
        }),
      this.signal,
    );
  }
  async run(c: AnimeContext, mode: Mode, selected?: SubtitleSearchResult): Promise<SubtitleCue[]> {
    if (mode === 'ko') return this.external(c, 'ko', selected);
    if (mode === 'ja') return this.translate(await this.external(c, 'ja', selected), c, 'ja');
    if (mode === 'en') return this.english(c);
    if (selected)
      return selected.language === 'ko'
        ? this.external(c, 'ko', selected)
        : this.translate(await this.external(c, 'ja', selected), c, 'ja');
    return autoMode(
      () => this.external(c, 'ko'),
      async () => this.translate(await this.external(c, 'ja'), c, 'ja'),
      () => this.english(c),
      (message) => this.status({ stage: 'fallback', message }),
    );
  }
}
