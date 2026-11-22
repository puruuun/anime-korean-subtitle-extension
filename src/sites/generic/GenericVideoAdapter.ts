import type { SiteAdapter } from '../types';
import { stableOriginPath } from '../../anime/AnimeContext';
import { findVideo } from '../../content/videoDetector';
import { detectEmbedded } from '../../content/subtitleSources';
import { isSpecializedSite, isWebVideoUrl } from '../adapter';

export class GenericVideoAdapter implements SiteAdapter {
  matches(url: string): boolean {
    return isWebVideoUrl(url) && !isSpecializedSite(url);
  }

  async getAnimeContext() {
    const url = location.href;
    const hostname = new URL(url).hostname;
    return {
      site: 'generic' as const,
      animeId: stableOriginPath(url),
      title: (document.title || hostname).trim(),
      episode: 1,
      pageUrl: url,
    };
  }

  async findVideo() {
    return findVideo();
  }

  findEmbeddedSubtitles(language = 'any') {
    return detectEmbedded(language);
  }
}
