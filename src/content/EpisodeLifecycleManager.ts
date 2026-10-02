import { episodeKey, siteAnimeId, type AnimeContext } from '../anime/AnimeContext';
import { normalizeTitle } from '../anime/titleNormalizer';

interface LifecycleOptions {
  detect: () => Promise<AnimeContext>;
  url: () => string;
  navigate: () => void | Promise<void>;
  ready: (context: AnimeContext) => void | Promise<void>;
  now?: () => number;
  stabilityMs?: number;
}
export function navigationKey(url: string) {
  try {
    const u = new URL(url);
    return [u.hostname.replace(/^www\./, ''), siteAnimeId(url), u.searchParams.get('ep')].join(':');
  } catch {
    return url;
  }
}
/** Coalesces URL/DOM notifications; only stable episode identities reach the worker. */
export class EpisodeLifecycleManager {
  activeEpisodeKey?: string;
  private route?: string;
  private candidate?: { signature: string; since: number; samples: number };
  private busy = false;
  private revision = 0;
  private stopped = false;
  constructor(private options: LifecycleOptions) {}
  async check() {
    if (this.stopped) return;
    const route = navigationKey(this.options.url());
    if (this.route !== route) {
      const previous = this.route;
      this.route = route;
      this.candidate = undefined;
      this.activeEpisodeKey = undefined;
      this.revision++;
      if (previous !== undefined) await this.options.navigate();
    }
    if (this.busy) return;
    if (!siteAnimeId(this.options.url())) return;
    this.busy = true;
    const revision = this.revision;
    try {
      const context = await this.options.detect();
      if (
        this.stopped ||
        revision !== this.revision ||
        navigationKey(this.options.url()) !== route ||
        !context.title?.trim() ||
        !(context.episode > 0)
      )
        return;
      const key = episodeKey(context);
      const signature = key + ':' + normalizeTitle(context.title);
      const now = this.options.now?.() ?? Date.now();
      if (this.candidate?.signature !== signature)
        this.candidate = { signature, since: now, samples: 1 };
      else this.candidate.samples++;
      if (
        this.candidate.samples < 2 ||
        now - this.candidate.since < (this.options.stabilityMs ?? 400)
      )
        return;
      if (key === this.activeEpisodeKey) return;
      this.activeEpisodeKey = key;
      await this.options.ready(context);
    } catch {
      // Metadata is often absent during hydration. The observer/interval will try again.
      this.candidate = undefined;
    } finally {
      this.busy = false;
    }
  }
  stop() {
    this.stopped = true;
    this.revision++;
  }
}
