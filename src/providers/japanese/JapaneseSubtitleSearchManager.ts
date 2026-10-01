import type { AnimeContext } from '../../anime/AnimeContext';
import type { SubtitleProvider, SubtitleFile } from '../SubtitleProvider';
import { scoreResult } from '../../subtitle/SubtitleSearch';
import { loadUsableSubtitle } from '../../subtitle/loadUsableSubtitle';
import { withDeadline } from '../../utils/deadline';
import { log } from '../../utils/logger';
export class JapaneseSubtitleSearchManager {
  constructor(
    private providers: SubtitleProvider[],
    private timeoutMs = 8000,
  ) {}
  async resolve(c: AnimeContext, signal: AbortSignal): Promise<SubtitleFile | undefined> {
    for (const id of ['jimaku', 'kitsunekko']) {
      const provider = this.providers.find((p) => p.id === id);
      if (!provider) continue;
      signal.throwIfAborted();
      try {
        const usable = await withDeadline(signal, this.timeoutMs, async (attempt) => {
          log(id, { searching: true, episode: c.episode });
          const results = (await provider.search(c, 'ja', attempt))
            .map((r) => scoreResult(c, r, 'ja'))
            .filter((r) => r.autoEligible)
            .sort((a, b) => (b.score ?? 0) - (a.score ?? 0) || a.id.localeCompare(b.id));
          for (const candidate of results.slice(0, 8)) {
            attempt.throwIfAborted();
            try {
              return await loadUsableSubtitle(provider, candidate, c, attempt);
            } catch (error) {
              attempt.throwIfAborted();
              log(id, {
                candidate: candidate.filename,
                unavailable: error instanceof Error ? error.message : 'unknown',
              });
            }
          }
          return undefined;
        });
        if (usable) {
          log(id, { matchedEpisode: c.episode, file: usable.candidate.filename });
          return usable;
        }
        log(id, { usable: false });
      } catch (error) {
        signal.throwIfAborted();
        log(id, { unavailable: error instanceof Error ? error.message : 'unknown' });
      }
    }
    return undefined;
  }
}
