import type { SubtitleSource } from '../sites/types';
import { findVideo } from './videoDetector';
import { bridgeStore } from './bridgeStore';
import { plainText } from '../subtitle/SubtitleParser';
export function englishLanguage(language: string) {
  return /^(?:en(?:[-_].*)?|eng|english(?:\b.*)?)$/i.test(language.trim());
}
const LANGUAGE_URL_RULES: [RegExp, string][] = [
  [/(?:^|[\/_.-])(?:ko|kor|korean)(?:[\/_.-]|$)/i, 'ko'],
  [/(?:^|[\/_.-])(?:ja|jp|jpn|japanese)(?:[\/_.-]|$)/i, 'ja'],
  [/(?:^|[\/_.-])(?:en|eng|english)(?:[\/_.-]|$)/i, 'en'],
  [/(?:^|[\/_.-])(?:zh[-_]?(?:cn|hans)|chs)(?:[\/_.-]|$)/i, 'zh-CN'],
  [/(?:^|[\/_.-])(?:zh[-_]?(?:tw|hant)|cht)(?:[\/_.-]|$)/i, 'zh-TW'],
  [/(?:^|[\/_.-])(?:zh|chi|zho|chinese)(?:[\/_.-]|$)/i, 'zh-CN'],
  [/(?:^|[\/_.-])(?:es|spa|spanish)(?:[\/_.-]|$)/i, 'es'],
  [/(?:^|[\/_.-])(?:fr|fre|fra|french)(?:[\/_.-]|$)/i, 'fr'],
  [/(?:^|[\/_.-])(?:de|ger|deu|german)(?:[\/_.-]|$)/i, 'de'],
  [/(?:^|[\/_.-])(?:pt|por|portuguese)(?:[\/_.-]|$)/i, 'pt'],
  [/(?:^|[\/_.-])(?:vi|vie|vietnamese)(?:[\/_.-]|$)/i, 'vi'],
  [/(?:^|[\/_.-])(?:th|tha|thai)(?:[\/_.-]|$)/i, 'th'],
  [/(?:^|[\/_.-])(?:id|ind|indonesian)(?:[\/_.-]|$)/i, 'id'],
];
function guessLanguageFromUrl(url: string): string {
  const path = (() => {
    try {
      return new URL(url).pathname;
    } catch {
      return url;
    }
  })();
  for (const [pattern, code] of LANGUAGE_URL_RULES) if (pattern.test(path)) return code;
  return 'und';
}
function isOwnTrackLabel(label: string): boolean {
  return label.includes('AnimeSub') || label.includes('WebSub');
}
function normalizeLanguageTag(primary?: string, fallback?: string): string {
  return (primary || fallback || '').trim() || 'und';
}
function trackElements(root: Document | ShadowRoot): HTMLTrackElement[] {
  const out = [...root.querySelectorAll<HTMLTrackElement>('video track')];
  for (const e of root.querySelectorAll('*'))
    if (e.shadowRoot) out.push(...trackElements(e.shadowRoot));
  return out;
}
export async function detectEmbedded(language = 'en'): Promise<SubtitleSource[]> {
  const sources: SubtitleSource[] = [];
  const anyLanguage = language === 'any';
  for (const t of trackElements(document))
    if (
      t.src &&
      !isOwnTrackLabel(t.label) &&
      (language !== 'en' || englishLanguage(t.srclang) || englishLanguage(t.label))
    )
      sources.push({
        url: t.src,
        language: normalizeLanguageTag(t.srclang, t.label),
        label: t.label,
        kind: 'file',
      });
  const video = findVideo();
  if (video)
    for (const track of Array.from(video.textTracks)) {
      if (
        isOwnTrackLabel(track.label) ||
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
              language: normalizeLanguageTag(track.language, track.label),
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
    ...bridgeStore.sources
      .filter((s) => language !== 'en' || englishLanguage(s.language) || englishLanguage(s.label ?? ''))
      .map((s) => ({ ...s, language: normalizeLanguageTag(s.language, s.label) })),
  );
  for (const entry of performance.getEntriesByType('resource')) {
    if (anyLanguage) {
      if (
        /\.(?:vtt|srt|ass)(?:[?#]|$)/i.test(entry.name) &&
        !/(thumbnail|sprite|preview|storyboard)/i.test(entry.name) &&
        !sources.some((s) => s.url === entry.name)
      )
        sources.push({ url: entry.name, language: guessLanguageFromUrl(entry.name), kind: 'file' });
    } else if (
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
