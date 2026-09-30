import type { SubtitleSource } from '../sites/types';
import { findVideo } from './videoDetector';
import { bridgeStore } from './bridgeStore';
import { plainText } from '../subtitle/SubtitleParser';
export function englishLanguage(language: string) {
  return /^(?:en(?:[-_].*)?|eng|english(?:\b.*)?)$/i.test(language.trim());
}
function trackElements(root: Document | ShadowRoot): HTMLTrackElement[] {
  const out = [...root.querySelectorAll<HTMLTrackElement>('video track')];
  for (const e of root.querySelectorAll('*'))
    if (e.shadowRoot) out.push(...trackElements(e.shadowRoot));
  return out;
}
export async function detectEmbedded(language = 'en'): Promise<SubtitleSource[]> {
  const sources: SubtitleSource[] = [];
  for (const t of trackElements(document))
    if (t.src && (language !== 'en' || englishLanguage(t.srclang) || englishLanguage(t.label)))
      sources.push({ url: t.src, language: t.srclang || t.label, label: t.label, kind: 'file' });
  const video = findVideo();
  if (video)
    for (const track of Array.from(video.textTracks)) {
      if (
        track.label.includes('AnimeSub') ||
        !['subtitles', 'captions'].includes(track.kind) ||
        (language === 'en' && !englishLanguage(track.language) && !englishLanguage(track.label))
      )
        continue;
      const previous = track.mode;
      try {
        if (previous === 'disabled') track.mode = 'hidden';
        if (!track.cues?.length) await new Promise((r) => setTimeout(r, 600));
        if (track.cues?.length) {
          const cues = Array.from(track.cues)
            .filter((c): c is VTTCue => 'text' in c)
            .map((c, id) => ({
              id: id + 1,
              startTime: c.startTime,
              endTime: c.endTime,
              text: plainText(c.text),
            }))
            .filter((c) => c.text && c.endTime > c.startTime);
          if (cues.length)
            sources.push({
              language: track.language || track.label,
              label: track.label,
              cues,
              kind: 'texttrack',
            });
        }
      } finally {
        track.mode = previous;
      }
    }
  sources.push(
    ...bridgeStore.sources.filter(
      (s) => language !== 'en' || englishLanguage(s.language) || englishLanguage(s.label ?? ''),
    ),
  );
  for (const entry of performance.getEntriesByType('resource')) {
    if (
      /(?:^|[\/_-])(?:en|eng|english)(?:[\/_\-.])[^?#]*\.(?:vtt|srt|ass)(?:[?#]|$)/i.test(
        entry.name,
      ) &&
      !/(thumbnail|sprite|preview)/i.test(entry.name) &&
      !sources.some((s) => s.url === entry.name)
    )
      sources.push({ url: entry.name, language: 'en', kind: 'file' });
  }
  return sources;
}
