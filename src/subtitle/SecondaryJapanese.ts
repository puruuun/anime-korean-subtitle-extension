import type { AnimeContext } from '../anime/AnimeContext';
import type { SubtitleProvider } from '../providers/SubtitleProvider';
import { JapaneseSubtitleSearchManager } from '../providers/japanese/JapaneseSubtitleSearchManager';
import type { SubtitleSource } from '../sites/types';
import type { SubtitleCue } from './SubtitleCue';
import { loadEmbeddedSource } from './EmbeddedSubtitleLoader';
import { withDeadline } from '../utils/deadline';

export interface JapaneseStatus {
  state: 'off' | 'searching' | 'ready' | 'unavailable' | 'error';
  message: string;
  source?: string;
}

export function boundaryAlignmentScore(
  referenceCues: SubtitleCue[],
  targetCues: SubtitleCue[],
  deltaSeconds: number,
): number {
  let j = 0;
  let hits = 0;
  for (let i = 0; i < referenceCues.length; i++) {
    const rStart = referenceCues[i].startTime;
    while (j + 1 < targetCues.length && targetCues[j + 1].startTime + deltaSeconds <= rStart) {
      j++;
    }
    for (const k of [j, j + 1]) {
      if (k < targetCues.length) {
        const diff = Math.abs(rStart - (targetCues[k].startTime + deltaSeconds));
        if (diff <= 0.45) {
          hits += 1 - diff / 0.6;
          break;
        }
      }
    }
  }
  return hits;
}

export function alignJapaneseCues(
  referenceCues: SubtitleCue[],
  targetCues: SubtitleCue[],
): { cues: SubtitleCue[]; offsetSeconds: number; score: number } {
  if (referenceCues.length < 15 || targetCues.length < 15) {
    return { cues: targetCues, offsetSeconds: 0, score: 0 };
  }
  const zeroScore = boundaryAlignmentScore(referenceCues, targetCues, 0);
  let bestDelta = 0;
  let bestScore = zeroScore;
  for (let d = -45; d <= 45; d += 0.5) {
    const s = boundaryAlignmentScore(referenceCues, targetCues, d);
    if (s > bestScore) {
      bestScore = s;
      bestDelta = d;
    }
  }
  if (Math.abs(bestDelta) >= 1.5 && bestScore >= Math.max(12, zeroScore * 1.35)) {
    const shifted = targetCues
      .map((c) => ({
        ...c,
        startTime: Math.max(0, Number((c.startTime + bestDelta).toFixed(3))),
        endTime: Math.max(0.1, Number((c.endTime + bestDelta).toFixed(3))),
      }))
      .filter((c) => c.endTime > c.startTime);
    return { cues: shifted, offsetSeconds: bestDelta, score: bestScore };
  }
  return { cues: targetCues, offsetSeconds: 0, score: zeroScore };
}

export async function secondaryJapanese(
  c: AnimeContext,
  providers: SubtitleProvider[],
  signal: AbortSignal,
  embedded: () => Promise<SubtitleSource[]>,
  skipExternal = false,
  referenceCues?: SubtitleCue[],
): Promise<{ cues: SubtitleCue[]; source: string } | undefined> {
  if (!skipExternal) {
    const file = await new JapaneseSubtitleSearchManager(providers).resolve(
      c,
      signal,
      referenceCues,
    );
    if (file) return { cues: file.cues, source: file.candidate.providerId };
  }
  signal.throwIfAborted();
  try {
    return await withDeadline(signal, 10000, async (attempt) => {
      for (const source of await embedded()) {
        attempt.throwIfAborted();
        if (!/^(?:ja(?:[-_]|$)|jpn$|japanese|日本語)/i.test(source.language)) continue;
        try {
          const cues = await loadEmbeddedSource(source, attempt, 'ja');
          if (cues.length) return { cues, source: 'embedded-ja' };
        } catch {
          attempt.throwIfAborted();
        }
      }
      return undefined;
    });
  } catch {
    signal.throwIfAborted();
    return undefined;
  }
}
