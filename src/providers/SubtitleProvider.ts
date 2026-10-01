import type { AnimeContext } from '../anime/AnimeContext';
export type SourceLanguage = 'ko' | 'ja';
export interface SubtitleSearchResult {
  id: string;
  providerId: string;
  title: string;
  release: string;
  language: SourceLanguage;
  episode?: number | string;
  season?: number;
  year?: number;
  anilistId?: number;
  filename?: string;
  episodeConfidence?: number;
  episodeType?: 'ova' | 'sp' | 'special';
  imdbId?: string;
  tmdbId?: number;
  downloadUrl?: string;
  score?: number;
  autoEligible?: boolean;
  reasons?: string[];
  matchedTitle?: string;
  pageUrl?: string;
  author?: string;
  updatedAt?: string;
  requiredOrigins?: string[];
  linkMessage?: string;
}
export interface SubtitleCandidate extends SubtitleSearchResult {
  provider?: 'anissia' | 'jimaku' | 'kitsunekko';
}
export interface AnissiaSubtitleCandidate extends SubtitleCandidate {
  provider: 'anissia';
  providerId: 'anissia';
  episode: string;
  author: string;
  pageUrl: string;
  updatedAt: string;
  animeNo: number;
  subject: string;
  originalSubject: string;
  startDate: string;
  endDate: string;
}
export interface SubtitleProvider {
  id: string;
  search(
    context: AnimeContext,
    language: SourceLanguage,
    signal?: AbortSignal,
  ): Promise<SubtitleSearchResult[]>;
  download(result: SubtitleSearchResult, signal?: AbortSignal): Promise<ArrayBuffer>;
}

export interface SubtitleFile {
  candidate: SubtitleSearchResult;
  cues: import('../subtitle/SubtitleCue').SubtitleCue[];
}
export interface JapaneseSubtitleProvider extends SubtitleProvider {
  id: 'jimaku' | 'kitsunekko';
}
