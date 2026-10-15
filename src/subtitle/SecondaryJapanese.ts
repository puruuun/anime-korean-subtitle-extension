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
export async function secondaryJapanese(
  c: AnimeContext,
  providers: SubtitleProvider[],
  signal: AbortSignal,
  embedded: () => Promise<SubtitleSource[]>,
  skipExternal = false,
): Promise<{ cues: SubtitleCue[]; source: string } | undefined> {
  if (!skipExternal) {
    const file = await new JapaneseSubtitleSearchManager(providers).resolve(c, signal);
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
