import type { AnimeContext } from '../anime/AnimeContext';
import type { SubtitleCue } from '../subtitle/SubtitleCue';
export interface SubtitleSource {
  url?: string;
  language: string;
  label?: string;
  format?: string;
  cues?: SubtitleCue[];
  kind: 'file' | 'texttrack' | 'hls';
}
export interface SiteAdapter {
  matches(url: string): boolean;
  getAnimeContext(): Promise<AnimeContext>;
  findVideo(): Promise<HTMLVideoElement | null>;
  findEmbeddedSubtitles(language?: string): Promise<SubtitleSource[]>;
}
export interface PublicMetadata {
  title?: string | { english?: string; romaji?: string; native?: string };
  external_ids?: Record<string, string | number | (string | number)[]>;
  anilist_id?: number;
  mal_id?: number;
  imdb_id?: string;
  themoviedb_id?: number;
  season_year?: number;
  season?: number;
}
