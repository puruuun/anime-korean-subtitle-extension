import type { AnimeContext } from '../anime/AnimeContext';
import { normalizeTitle, titleCandidates } from '../anime/titleNormalizer';
import type { SourceLanguage, SubtitleSearchResult } from '../providers/SubtitleProvider';
import { normalizeEpisode } from '../anime/episodeNormalizer';
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
  const id = !!(
    (c.anilistId && r.anilistId === c.anilistId) ||
    (c.imdbId && r.imdbId === c.imdbId) ||
    (c.tmdbId && r.tmdbId === c.tmdbId)
  );
  const title = titleCandidates(c).some(
    (t) => normalizeTitle(t) === normalizeTitle(r.matchedTitle ?? r.title),
  );
  const episode = normalizeEpisode(r.episode);
  const episodeMatches = episode !== undefined && episode === normalizeEpisode(c.episode);
  if (id) add(100, 'ID 일치');
  if (title) add(50, '제목 일치');
  if (c.season !== undefined && r.season === c.season) add(30, '시즌 일치');
  if (episodeMatches) add(50, '회차 일치');
  if (c.year && r.year === c.year) add(10, '연도 일치');
  if (r.language === language) add(100, '언어 일치');
  const conflict =
    (r.episode !== undefined && !episodeMatches) ||
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
      !conflict && episodeMatches && r.language === language && (id || title) && score >= 120,
  };
}
