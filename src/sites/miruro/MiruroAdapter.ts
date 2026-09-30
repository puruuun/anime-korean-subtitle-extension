import type { SiteAdapter } from '../types';
import { miruroContext } from './metadata';
import { findVideo } from '../../content/videoDetector';
import { detectMiruroSubtitles } from './subtitleDetector';
export class MiruroAdapter implements SiteAdapter {
  matches(url: string) {
    return /(^|\.)miruro\.to$/.test(new URL(url).hostname);
  }
  async getAnimeContext() {
    return miruroContext();
  }
  async findVideo() {
    return findVideo();
  }
  findEmbeddedSubtitles(language?: string) {
    return detectMiruroSubtitles(language);
  }
}
