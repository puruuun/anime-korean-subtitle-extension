import type { SiteAdapter } from '../types';
import { reanimeContext } from './metadata';
import { findVideo } from '../../content/videoDetector';
import { detectReAnimeSubtitles } from './subtitleDetector';
export class ReAnimeAdapter implements SiteAdapter {
  matches(url: string) {
    return /(^|\.)reanime\.(?:to|cz)$/.test(new URL(url).hostname);
  }
  async getAnimeContext() {
    return reanimeContext();
  }
  async findVideo() {
    return findVideo();
  }
  findEmbeddedSubtitles(language?: string) {
    return detectReAnimeSubtitles(language);
  }
}
