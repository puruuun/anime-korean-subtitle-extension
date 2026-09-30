import type { AnimeContext } from '../anime/AnimeContext';
export type SourceLanguage = 'ko' | 'ja';
export interface SubtitleSearchResult {
  id: string;
  providerId: string;
  title: string;
  release: string;
  language: SourceLanguage;
  episode?: number;
  season?: number;
  year?: number;
  imdbId?: string;
  tmdbId?: number;
  downloadUrl?: string;
  fileId?: number;
  score?: number;
  autoEligible?: boolean;
  reasons?: string[];
}
export interface SubtitleProvider {
  id: string;
  search(context: AnimeContext, language: SourceLanguage): Promise<SubtitleSearchResult[]>;
  download(result: SubtitleSearchResult): Promise<ArrayBuffer>;
}
