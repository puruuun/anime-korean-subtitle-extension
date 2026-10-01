import type { AnimeContext } from '../anime/AnimeContext';
import type {
  SubtitleProvider,
  SubtitleSearchResult,
  SubtitleFile,
} from '../providers/SubtitleProvider';
import { SubtitleCache } from './SubtitleCache';
import { extractSubtitle } from './archive';
import { parseSubtitle } from './SubtitleParser';
import { titleSignature } from '../anime/titleNormalizer';
import { decodeSubtitle } from '../utils/encoding';
export async function loadUsableSubtitle(
  provider: SubtitleProvider,
  candidate: SubtitleSearchResult,
  c: AnimeContext,
  signal: AbortSignal,
): Promise<SubtitleFile> {
  signal.throwIfAborted();
  const cache = new SubtitleCache();
  const key = JSON.stringify([
    provider.id,
    candidate.id,
    candidate.downloadUrl ?? candidate.pageUrl,
    candidate.updatedAt,
    candidate.fileEpisodes,
    candidate.requireEpisodeMatch,
    candidate.language,
    candidate.season,
    candidate.episodeType,
  ]);
  let buffer = await cache.get(key);
  signal.throwIfAborted();
  const cached = !!buffer;
  if (!buffer) buffer = await provider.download(candidate, signal);
  signal.throwIfAborted();
  const { bytes, name } = extractSubtitle(
    buffer,
    c.episode,
    c.episodeType,
    c.season ?? titleSignature(c.title).season ?? 1,
    candidate.fileEpisodes,
    candidate.requireEpisodeMatch,
    candidate.language,
  );
  const cues = parseSubtitle(
    decodeSubtitle(bytes, candidate.language),
    (name === 'subtitle' ? candidate.filename : name)?.split('.').at(-1),
  );
  signal.throwIfAborted();
  if (!cached) await cache.put(key, buffer);
  signal.throwIfAborted();
  return { candidate, cues };
}
