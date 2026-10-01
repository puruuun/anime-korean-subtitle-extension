import type { SubtitleSearchResult } from '../../providers/SubtitleProvider';
import { filenameEpisode, normalizeEpisode } from '../../anime/episodeNormalizer';
import { extractSubtitle } from '../archive';
import type { ResolvedSubtitleFile } from './SubtitleLinkResolver';
export function verifyFileEpisode(
  file: ResolvedSubtitleFile,
  candidate: SubtitleSearchResult,
): boolean {
  const bytes = new Uint8Array(file.buffer);
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) {
    extractSubtitle(
      file.buffer,
      Number(candidate.episode),
      candidate.episodeType,
      candidate.season ?? 1,
      candidate.fileEpisodes,
      candidate.requireEpisodeMatch,
      candidate.language,
    );
    return true;
  }
  const parsed = filenameEpisode(file.name, candidate.season);
  return (
    (!parsed && !candidate.requireEpisodeMatch) ||
    !!(
      parsed &&
      (candidate.fileEpisodes ?? [normalizeEpisode(candidate.episode)]).includes(parsed.episode) &&
      parsed.special === candidate.episodeType &&
      (parsed.season === undefined || parsed.season === (candidate.season ?? 1))
    )
  );
}
