import type { SiteAdapter } from '../types';
import { reanimeContext } from './metadata';
import { findVideo } from '../../content/videoDetector';
import { detectReAnimeSubtitles } from './subtitleDetector';
export class ReAnimeAdapter implements SiteAdapter {
  matches(url: string) {
    return new URL(url).hostname === 'reanime.to';
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
