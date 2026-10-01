import type { AnimeContext } from '../anime/AnimeContext';
import type { Settings } from '../storage/settings';
import type { SubtitleProvider, SubtitleSearchResult } from '../providers/SubtitleProvider';
import type { SubtitleSource } from '../sites/types';
import type { SubtitleCue } from './SubtitleCue';
import { JapaneseSubtitleSearchManager } from '../providers/japanese/JapaneseSubtitleSearchManager';
import { loadUsableSubtitle } from './loadUsableSubtitle';
import { scoreResult } from './SubtitleSearch';
import { SelectionRequired } from './SubtitleSelection';
import { SubtitleLinkUnavailable } from './links/SubtitleLinkResolver';
import { loadEmbeddedSource } from './EmbeddedSubtitleLoader';
import { withDeadline } from '../utils/deadline';
import { AppError } from '../utils/errors';
import { log } from '../utils/logger';
export type Mode = Settings['mode'];
export interface PipelineResult {
  cues: SubtitleCue[];
  language: 'ko' | 'ja' | 'en';
  source: string;
}
export class SubtitlePipeline {
  constructor(
    private providers: SubtitleProvider[],
    private settings: Settings,
    private status: (s: { stage: string; message: string; source?: string }) => void,
    private signal: AbortSignal,
    private embedded?: () => Promise<SubtitleSource[]>,
  ) {}
  private async korean(
    c: AnimeContext,
    manual: boolean,
    selected?: SubtitleSearchResult,
  ): Promise<PipelineResult | undefined> {
    const provider = this.providers.find((p) => p.id === 'anissia');
    if (!provider) return undefined;
    this.status({ stage: 'search', message: '한국어 자막 검색 중...' });
    let candidates: SubtitleSearchResult[] = [];
    let resolved = false;
    try {
      return await withDeadline(this.signal, 10000, async (signal) => {
        candidates = selected
          ? [selected]
          : (await provider.search(c, 'ko', signal))
              .map((r) => scoreResult(c, r, 'ko'))
              .sort(
                (a, b) =>
                  (b.score ?? 0) - (a.score ?? 0) ||
                  (b.updatedAt ?? '').localeCompare(a.updatedAt ?? '') ||
                  a.id.localeCompare(b.id),
              );
        for (const candidate of candidates.filter((r) => selected || r.autoEligible).slice(0, 8)) {
          signal.throwIfAborted();
          try {
            const usable = await loadUsableSubtitle(provider, candidate, c, signal);
            resolved = true;
            this.status({
              stage: 'source',
              message: 'Anissia 한국어 자막 사용 중',
              source: 'anissia',
            });
            return { cues: usable.cues, language: 'ko', source: 'anissia' };
          } catch (error) {
            signal.throwIfAborted();
            if (error instanceof SubtitleLinkUnavailable)
              Object.assign(candidate, {
                pageUrl: error.resolution.pageUrl,
                requiredOrigins: error.resolution.requiredOrigins,
                linkMessage: error.message,
              });
            log('Anissia', {
              usable: false,
              reason: error instanceof Error ? error.message : 'unknown',
            });
          }
        }
        return undefined;
      });
    } catch (error) {
      this.signal.throwIfAborted();
      log('Anissia', { unavailable: error instanceof Error ? error.message : 'unknown' });
      return undefined;
    } finally {
      this.signal.throwIfAborted();
      if (
        !resolved &&
        manual &&
        candidates.length &&
        candidates.every((r) => !r.autoEligible || r.linkMessage)
      )
        throw new SelectionRequired(candidates, 'ko');
    }
  }
  private async japanese(c: AnimeContext): Promise<PipelineResult | undefined> {
    this.status({ stage: 'search', message: '일본어 자막 검색 중...' });
    const file = await new JapaneseSubtitleSearchManager(this.providers).resolve(c, this.signal);
    if (!file) return undefined;
    this.status({
      stage: 'source',
      message: '일본어 자막 발견 · 한국어 번역 준비 중',
      source: file.candidate.providerId,
    });
    return { cues: file.cues, language: 'ja', source: file.candidate.providerId };
  }
  private async english(): Promise<PipelineResult | undefined> {
    this.status({ stage: 'extract', message: '사이트 영어 자막 추출 중...' });
    try {
      return await withDeadline(this.signal, 10000, async (signal) => {
        const sources = await this.embedded?.();
        signal.throwIfAborted();
        for (const source of sources ?? []) {
          if (!/^(?:en(?:[-_]|$)|english)/i.test(source.language)) continue;
          try {
            const cues = await loadEmbeddedSource(source, signal);
            if (!cues.length) continue;
            this.status({
              stage: 'source',
              message: '사이트 영어 자막 사용 · 한국어 번역 준비 중',
              source: 'embedded-en',
            });
            return { cues, language: 'en', source: 'embedded-en' };
          } catch (error) {
            signal.throwIfAborted();
            log('EmbeddedEnglish', {
              unavailable: error instanceof Error ? error.message : 'unknown',
            });
          }
        }
        return undefined;
      });
    } catch (error) {
      this.signal.throwIfAborted();
      log('EmbeddedEnglish', { unavailable: error instanceof Error ? error.message : 'unknown' });
      return undefined;
    }
  }
  async resolve(
    c: AnimeContext,
    mode: Mode,
    selected?: SubtitleSearchResult,
  ): Promise<PipelineResult> {
    this.signal.throwIfAborted();
    log('SubtitlePipeline', { mode, anime: c.title, episode: c.episode });
    if (mode !== 'auto') {
      const result =
        mode === 'ko'
          ? await this.korean(c, true, selected)
          : mode === 'ja'
            ? await this.japanese(c)
            : await this.english();
      if (result) return result;
      throw new AppError(
        'NOT_FOUND',
        mode === 'ko'
          ? '한국어 자막을 찾을 수 없습니다.'
          : mode === 'ja'
            ? '일본어 자막을 찾을 수 없습니다.'
            : '사이트 영어 자막을 찾을 수 없습니다.',
      );
    }
    const enabled = this.settings.autoSources;
    if (enabled.anissia) {
      const ko = await this.korean(c, false);
      if (ko) return ko;
    }
    if (enabled.japaneseTranslation) {
      const ja = await this.japanese(c);
      if (ja) return ja;
    }
    if (enabled.embeddedEnglish) {
      const en = await this.english();
      if (en) return en;
    }
    throw new AppError('NOT_FOUND', '사용 가능한 한국어/일본어/영어 자막을 찾지 못했습니다.');
  }
}
