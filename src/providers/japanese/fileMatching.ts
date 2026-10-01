import type { AnimeContext } from '../../anime/AnimeContext';
import { filenameEpisode, normalizeEpisode } from '../../anime/episodeNormalizer';
import type { SubtitleSearchResult } from '../SubtitleProvider';
import { titleSignature } from '../../anime/titleNormalizer';

export { filenameEpisode } from '../../anime/episodeNormalizer';

export function japaneseFileCandidate(
  c: AnimeContext,
  providerId: 'jimaku' | 'kitsunekko',
  entry: { title: string; matchedTitle: string; anilistId?: number },
  file: { name: string; url: string; updatedAt?: string },
): SubtitleSearchResult | undefined {
  if (!/\.(srt|ass|ssa|vtt)$/i.test(file.name)) return undefined;
  // Jimaku also hosts subtitles in other languages. Do not mistake an English upload for JA.
  if (/(?:^|[\s._-])(?:en|eng|english|ko|kor|korean|chs|cht|zh)(?:$|[\s._-])/i.test(file.name))
    return undefined;
  const parsed = filenameEpisode(file.name);
  if (!parsed || parsed.episode !== normalizeEpisode(c.episode)) return undefined;
  if (parsed.special ? parsed.special !== c.episodeType : !!c.episodeType) return undefined;
  const season = parsed.season ?? titleSignature(entry.title).season;
  if (season !== undefined && season !== (c.season ?? titleSignature(c.title).season ?? 1))
    return undefined;
  const year = file.name.match(/\b((?:19|20)\d{2})\b/)?.[1];
  if (year && c.year && Number(year) !== c.year) return undefined;
  return {
    id: JSON.stringify([providerId, file.url, file.updatedAt ?? '']),
    providerId,
    title: entry.title,
    matchedTitle: entry.matchedTitle,
    release: file.name,
    filename: file.name,
    downloadUrl: file.url,
    language: 'ja',
    episode: parsed.episode,
    episodeType: c.episodeType,
    season: season ?? c.season,
    year: year ? Number(year) : undefined,
    anilistId: entry.anilistId,
    updatedAt: file.updatedAt,
    episodeConfidence: 1,
  };
}
