import type { SubtitleCue } from './SubtitleCue';
export interface Subtitle {
  cues: SubtitleCue[];
  language: string;
  sourceHash: string;
  format: 'srt' | 'vtt' | 'ass';
}
