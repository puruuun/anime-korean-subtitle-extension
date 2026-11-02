import type { AnimeContext } from '../anime/AnimeContext';
import { contextKey } from '../anime/AnimeContext';
import type { SubtitleCue } from '../subtitle/SubtitleCue';
import type { Settings } from '../storage/settings';
import type { CoreStatus, Mode } from '../subtitle/SubtitleCore';
import type { TranslationQueue } from '../translation/TranslationQueue';
import type { JapaneseStatus } from '../subtitle/SecondaryJapanese';
import type { AutoEpisode } from './autoRetry';

export interface JobStatus extends CoreStatus {
  jobId: string;
  context: AnimeContext;
  mode: Mode;
  busy: boolean;
  epoch: number;
  offset: number;
  updatedAt: number;
  episodeKey?: string;
  startedAt?: number;
  finishedAt?: number;
  workElapsedMs?: number;
  workActiveSince?: number;
  japanese?: JapaneseStatus;
  playbackTime?: number;
  cached?: boolean;
  retry?: {
    attempt: number;
    maxAttempts: number;
    nextAt?: number;
    deadlineAt: number;
    reason?: string;
  };
}

export interface Job {
  controller: AbortController;
  status: JobStatus;
  cues: SubtitleCue[];
  settings: Settings;
  queue?: TranslationQueue;
  primaryFrame: number;
  primaryDocument?: string;
  playbackTime: number;
  sourceLanguage?: 'ja' | 'en';
  bootstrapReady: boolean;
  writes: Promise<void>;
  cacheKey: string;
  originalCues?: SubtitleCue[];
  japaneseCues?: SubtitleCue[];
  japaneseSource?: string;
  japaneseController?: AbortController;
  automatic?: AutoEpisode;
}

export function trustedUI(sender: chrome.runtime.MessageSender): boolean {
  return (
    sender.id === chrome.runtime.id &&
    !!sender.url &&
    [chrome.runtime.getURL('popup.html'), chrome.runtime.getURL('settings.html')].some(
      (u) => sender.url!.split('?')[0] === u,
    )
  );
}

export function uiStatus(status: JobStatus): JobStatus {
  return { ...status, results: status.results?.map(({ downloadUrl: _, ...r }) => r) };
}

export function renderSnapshot(j: Job) {
  return {
    cues: j.cues,
    japaneseCues: j.japaneseCues,
    japaneseSource: j.japaneseSource,
    originalCues: j.originalCues,
    cacheKey: j.cacheKey,
    display: j.settings.display,
    offset: j.status.offset,
    epoch: j.status.epoch,
    contextKey: contextKey(j.status.context),
    bootstrapReady: j.bootstrapReady,
    immediatePlayback: j.settings.translation.immediatePlayback,
    sourceLanguage: j.sourceLanguage,
    translation: j.status.translation,
    stage: j.status.stage,
    message: j.status.message,
  };
}

export type RenderSnapshot = ReturnType<typeof renderSnapshot>;
