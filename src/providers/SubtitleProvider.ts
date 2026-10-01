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
  imdbId?: string;
  tmdbId?: number;
  downloadUrl?: string;
  fileId?: number;
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
  search(context: AnimeContext, language: SourceLanguage): Promise<SubtitleSearchResult[]>;
  download(result: SubtitleSearchResult): Promise<ArrayBuffer>;
}
