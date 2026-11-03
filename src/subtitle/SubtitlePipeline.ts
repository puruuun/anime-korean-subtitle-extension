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
import { normalizeEpisode } from '../anime/episodeNormalizer';
export type Mode = Settings['mode'];
export interface PipelineResult {
  cues: SubtitleCue[];
  language: 'ko' | 'ja' | 'en';
  source: string;
}
export class SubtitlePipeline {
  private blockedOrigins = new Set<string>();
  constructor(
    private providers: SubtitleProvider[],
    private settings: Settings,
    private status: (s: {
      stage: string;
      message: string;
      source?: string;
      path?: string;
      warnings?: string[];
    }) => void,
    private signal: AbortSignal,
    private embedded?: () => Promise<SubtitleSource[]>,
  ) {}

  private handleCandidateError(candidate: SubtitleSearchResult, error: unknown) {
    if (error instanceof SubtitleLinkUnavailable) {
      Object.assign(candidate, {
        pageUrl: error.resolution.pageUrl,
        requiredOrigins: error.resolution.requiredOrigins,
        linkMessage: error.message,
      });
      for (const origin of error.resolution.requiredOrigins ?? []) this.blockedOrigins.add(origin);
      if (this.blockedOrigins.size)
        this.status({
          stage: 'search',
          message: '다음 자막 소스를 확인하는 중...',
          warnings: ['배포 도메인 접근이 차단되어 있습니다. 설정에서 사이트 접근을 확인하세요.'],
        });
    } else {
      candidate.linkMessage =
        error instanceof AppError
          ? error.message
          : '자막 파일을 처리하지 못했습니다. 배포 페이지를 확인하세요.';
    }
    log(candidate.providerId, {
      usable: false,
      reason: error instanceof Error ? error.message : 'unknown',
    });
  }

  private async korean(
    c: AnimeContext,
    manual: boolean,
    selected?: SubtitleSearchResult,
  ): Promise<PipelineResult | undefined> {
    const provider = this.providers.find((p) => p.id === 'anissia');
    const webProvider =
      this.providers.find((p) => p.id === 'web-ko') ??
      (provider as { webFallback?: SubtitleProvider } | undefined)?.webFallback;

    if (!provider && !webProvider) return undefined;

    const deadlineMs = manual ? 30000 : webProvider ? 15000 : 10000;
    let candidates: SubtitleSearchResult[] = [];
    let resolved = false;

    try {
      return await withDeadline(this.signal, deadlineMs, async (signal) => {
        if (selected) {
          const targetProvider =
            selected.providerId === 'web-ko' && webProvider
              ? webProvider
              : (provider ?? webProvider)!;
          candidates = [selected];
          signal.throwIfAborted();
          this.status({
            stage: 'download',
            message: '한국어 자막 다운로드·회차 확인 중 · ' + (selected.author ?? selected.release),
            path: selected.providerId === 'web-ko' ? 'Web Search (KO)' : 'Anissia',
          });
          if (normalizeEpisode(selected.episode) !== normalizeEpisode(c.episode))
            throw new AppError('EPISODE', '선택한 자막 후보의 회차가 현재 영상과 다릅니다.');
          const usable = await loadUsableSubtitle(targetProvider, selected, c, signal);
          resolved = true;
          this.status({
            stage: 'source',
            message:
              selected.providerId === 'web-ko'
                ? '웹 한국어 자막 사용 중'
                : 'Anissia 한국어 자막 사용 중',
            source: selected.providerId,
          });
          return { cues: usable.cues, language: 'ko', source: selected.providerId };
        }

        if (provider) {
          this.status({
            stage: 'search',
            message: 'Anissia 한국어 자막을 찾는 중...',
            path: 'Anissia',
          });
          try {
            const anissiaHits = (await provider.search(c, 'ko', signal))
              .map((r) => scoreResult(c, r, 'ko'))
              .sort(
                (a, b) =>
                  (b.score ?? 0) - (a.score ?? 0) ||
                  (b.updatedAt ?? '').localeCompare(a.updatedAt ?? '') ||
                  a.id.localeCompare(b.id),
              );
            candidates.push(...anissiaHits);

            for (const candidate of anissiaHits.filter((r) => r.autoEligible).slice(0, 8)) {
              signal.throwIfAborted();
              try {
                this.status({
                  stage: 'download',
                  message:
                    '한국어 자막 다운로드·회차 확인 중 · ' +
                    (candidate.author ?? candidate.release),
                  path: 'Anissia',
                });
                if (normalizeEpisode(candidate.episode) !== normalizeEpisode(c.episode))
                  throw new AppError('EPISODE', '선택한 자막 후보의 회차가 현재 영상과 다릅니다.');
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
                this.handleCandidateError(candidate, error);
              }
            }
          } catch (error) {
            signal.throwIfAborted();
            log('Anissia', { unavailable: error instanceof Error ? error.message : 'unknown' });
            if (!webProvider && manual && !candidates.length) throw error;
          }
        }

        if (webProvider) {
          signal.throwIfAborted();
          this.status({
            stage: 'search',
            message: '웹에서 한국어 자막 블로그를 찾는 중...',
            path: 'Web Search (KO)',
          });
          try {
            const webHits = (await webProvider.search(c, 'ko', signal))
              .map((r) => scoreResult(c, r, 'ko'))
              .sort(
                (a, b) =>
                  (b.score ?? 0) - (a.score ?? 0) ||
                  (b.updatedAt ?? '').localeCompare(a.updatedAt ?? '') ||
                  a.id.localeCompare(b.id),
              );
            candidates.push(...webHits);

            for (const candidate of webHits.filter((r) => r.autoEligible).slice(0, 6)) {
              signal.throwIfAborted();
              try {
                this.status({
                  stage: 'download',
                  message:
                    '한국어 자막 다운로드·회차 확인 중 · ' +
                    (candidate.author ?? candidate.release),
                  path: 'Web Search (KO)',
                });
                if (normalizeEpisode(candidate.episode) !== normalizeEpisode(c.episode))
                  throw new AppError('EPISODE', '선택한 자막 후보의 회차가 현재 영상과 다릅니다.');
                const usable = await loadUsableSubtitle(webProvider, candidate, c, signal);
                resolved = true;
                this.status({
                  stage: 'source',
                  message: '웹 한국어 자막 사용 중',
                  source: 'web-ko',
                });
                return { cues: usable.cues, language: 'ko', source: 'web-ko' };
              } catch (error) {
                signal.throwIfAborted();
                this.handleCandidateError(candidate, error);
              }
            }
          } catch (error) {
            signal.throwIfAborted();
            log('WebKorean', { unavailable: error instanceof Error ? error.message : 'unknown' });
            if (manual && !candidates.length) throw error;
          }
        }

        return undefined;
      });
    } catch (error) {
      this.signal.throwIfAborted();
      log('KoreanPipeline', { unavailable: error instanceof Error ? error.message : 'unknown' });
      if (manual && !candidates.length) throw error;
      for (const candidate of candidates)
        candidate.linkMessage ??=
          error instanceof AppError ? error.message : '자막 파일을 처리하지 못했습니다.';
      return undefined;
    } finally {
      this.signal.throwIfAborted();
      if (!resolved && manual && candidates.length)
        throw new SelectionRequired(
          candidates,
          'ko',
          '한국어 자막 후보를 찾았지만 파일을 적용하지 못했습니다. 아래 원인을 확인하세요.',
        );
    }
  }

  private async japanese(c: AnimeContext): Promise<PipelineResult | undefined> {
    this.status({
      stage: 'search',
      message: 'Jimaku → Kitsunekko 일본어 자막을 찾는 중...',
      path: 'Jimaku → Kitsunekko',
    });
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
    this.status({
      stage: 'extract',
      message: '플레이어 영어 자막을 읽는 중...',
      path: 'Embedded English',
    });
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
    if (this.blockedOrigins.size)
      throw new AppError(
        'HOST_ACCESS',
        '배포 도메인 접근이 차단되었습니다: ' +
          [...this.blockedOrigins].join(', ') +
          ' · 설정에서 사이트 접근을 확인하세요.',
      );
    throw new AppError('NOT_FOUND', '사용 가능한 한국어/일본어/영어 자막을 찾지 못했습니다.');
  }
}
