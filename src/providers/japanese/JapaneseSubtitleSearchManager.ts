import type { AnimeContext } from '../../anime/AnimeContext';
import type { SubtitleProvider, SubtitleFile } from '../SubtitleProvider';
import type { SubtitleCue } from '../../subtitle/SubtitleCue';
import { scoreResult } from '../../subtitle/SubtitleSearch';
import { loadUsableSubtitle } from '../../subtitle/loadUsableSubtitle';
import { alignJapaneseCues, boundaryAlignmentScore } from '../../subtitle/SecondaryJapanese';
import { withDeadline } from '../../utils/deadline';
import { log } from '../../utils/logger';

export class JapaneseSubtitleSearchManager {
  constructor(
    private providers: SubtitleProvider[],
    private timeoutMs = 8000,
  ) {}

  async resolve(
    c: AnimeContext,
    signal: AbortSignal,
    referenceCues?: SubtitleCue[],
  ): Promise<SubtitleFile | undefined> {
    const hasReference = !!(referenceCues && referenceCues.length >= 15);

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

          if (!hasReference) {
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
          }

          let best: { file: SubtitleFile; alignedCues: SubtitleCue[]; score: number } | undefined;
          let loadedCount = 0;

          for (const candidate of results.slice(0, 8)) {
            attempt.throwIfAborted();
            try {
              const file = await loadUsableSubtitle(provider, candidate, c, attempt);
              loadedCount++;
              const aligned = alignJapaneseCues(referenceCues!, file.cues);
              const zeroScore = boundaryAlignmentScore(referenceCues!, file.cues, 0);

              if (
                loadedCount === 1 &&
                zeroScore >= Math.min(referenceCues!.length, file.cues.length) * 0.25
              ) {
                return { ...file, cues: aligned.cues };
              }

              if (!best || aligned.score > best.score) {
                best = { file, alignedCues: aligned.cues, score: aligned.score };
              }

              if (loadedCount >= 3) break;
            } catch (error) {
              attempt.throwIfAborted();
              log(id, {
                candidate: candidate.filename,
                unavailable: error instanceof Error ? error.message : 'unknown',
              });
            }
          }

          if (best) {
            return { ...best.file, cues: best.alignedCues };
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
