import type { AnimeContext } from '../anime/AnimeContext';
import { normalizeTitle, titleCandidates } from '../anime/titleNormalizer';
import type {
  SourceLanguage,
  SubtitleSearchResult,
  SubtitleProvider,
} from '../providers/SubtitleProvider';
import { AppError } from '../utils/errors';
export function scoreResult(
  c: AnimeContext,
  r: SubtitleSearchResult,
  language: SourceLanguage,
): SubtitleSearchResult {
  let score = 0;
  const reasons: string[] = [];
  const add = (n: number, reason: string) => {
    score += n;
    reasons.push(reason);
  };
  const id = !!((c.imdbId && r.imdbId === c.imdbId) || (c.tmdbId && r.tmdbId === c.tmdbId));
  const title = titleCandidates(c).some((t) => normalizeTitle(t) === normalizeTitle(r.title));
  if (id) add(100, 'ID 일치');
  if (title) add(50, '제목 일치');
  if (c.season !== undefined && r.season === c.season) add(30, '시즌 일치');
  if (r.episode === c.episode) add(50, '회차 일치');
  if (c.year && r.year === c.year) add(10, '연도 일치');
  if (r.language === language) add(100, '언어 일치');
  const conflict =
    (r.episode !== undefined && r.episode !== c.episode) ||
    (c.season !== undefined && r.season !== undefined && c.season !== r.season);
  if (conflict) {
    score -= 500;
    reasons.push('회차 또는 시즌 불일치');
  }
  if (r.episode === undefined) reasons.push('회차 정보 불명');
  return {
    ...r,
    score,
    reasons,
    autoEligible:
      !conflict &&
      r.episode === c.episode &&
      r.language === language &&
      (id || title) &&
      score >= 120,
  };
}
export class SubtitleSearch {
  constructor(private providers: SubtitleProvider[]) {}
  async search(c: AnimeContext, language: SourceLanguage, signal?: AbortSignal) {
    const results: SubtitleSearchResult[] = [];
    const errors: string[] = [];
    for (const p of this.providers) {
      signal?.throwIfAborted();
      try {
        results.push(...(await p.search(c, language)).map((r) => scoreResult(c, r, language)));
      } catch {
        errors.push(p.id + ' 검색 실패');
      }
    }
    if (!results.length && errors.length)
      throw new AppError('PROVIDER', '자막 Provider 요청에 실패했습니다: ' + errors.join(', '));
    return {
      results: [...new Map(results.map((r) => [r.id, r])).values()].sort(
        (a, b) => (b.score ?? 0) - (a.score ?? 0),
      ),
      warnings: errors,
    };
  }
}
