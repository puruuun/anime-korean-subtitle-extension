import type { AnimeContext } from '../anime/AnimeContext';
import type { Settings } from '../storage/settings';
import type { SubtitleCue } from '../subtitle/SubtitleCue';
import { subtitleHash } from '../subtitle/SubtitleCache';
import { AppError } from '../utils/errors';
import { log } from '../utils/logger';
import { chunkCues } from './TranslationManager';
import { TranslationCache, translationKey, type TranslationStore } from './TranslationCache';
import {
  validateTranslations,
  type TranslatedCue,
  type TranslationCue,
  type TranslationProvider,
} from './TranslationProvider';

export type TranslationChunkState = 'pending' | 'translating' | 'completed' | 'failed';

export interface TranslationBufferStatus {
  playbackTime: number;
  translatedUntil: number;
  bufferSeconds: number;
  targetBufferSeconds: number;
  completedChunks: number;
  totalChunks: number;
  failedChunks: number;
  chunks: {
    index: number;
    startTime: number;
    endTime: number;
    state: TranslationChunkState;
    attempts: number;
  }[];
}

export interface TranslationQueueCallbacks {
  /** Newly available cues only; the caller merges them into the episode's subtitle store. */
  onChunk: (cues: SubtitleCue[], snapshot: TranslationBufferStatus) => void | Promise<void>;
  onState: (snapshot: TranslationBufferStatus) => void;
}

interface QueueChunk {
  index: number;
  offset: number;
  source: SubtitleCue[];
  startTime: number;
  endTime: number;
  state: TranslationChunkState;
  attempts: number;
  key: string;
  translated?: SubtitleCue[];
}

interface ActiveRequest {
  chunk: QueueChunk;
  controller: AbortController;
  preempted: boolean;
}

/** A single-episode queue. Playback controls priority, but never waits for this queue to finish. */
export class TranslationQueue {
  private chunks: QueueChunk[] = [];
  private playbackTime = 0;
  private active?: ActiveRequest;
  private callbacks?: TranslationQueueCallbacks;
  private source: SubtitleCue[] = [];
  private bootstrapReady = false;
  private running = false;
  private episodeSignal?: AbortSignal;

  constructor(
    private provider: TranslationProvider,
    private config: Settings['translation'],
    private cache: TranslationStore = new TranslationCache(),
  ) {}

  updatePlayback(time: number, seek = false): void {
    if (!Number.isFinite(time)) return;
    this.playbackTime = Math.max(0, time);
    // Keep bootstrap small and predictable even if the player initially opens at a saved position.
    if (seek && this.bootstrapReady && this.active) {
      const preferred = this.chooseChunk(true);
      if (preferred && preferred.index !== this.active.chunk.index) {
        this.active.preempted = true;
        this.active.controller.abort(new DOMException('Playback priority changed.', 'AbortError'));
      }
    }
    if (!this.episodeSignal?.aborted) this.emitState();
  }

  snapshot(): TranslationBufferStatus {
    const time = this.playbackTime;
    // The first missing cue after playback is a hole. Completed chunks after that hole do not
    // inflate the buffer. Silence before a missing cue is safe to play and counts as covered.
    const firstMissing = this.chunks
      .filter((chunk) => chunk.state !== 'completed')
      .flatMap((chunk) => chunk.source)
      .find((cue) => cue.endTime > time);
    const episodeEnd = this.source.reduce((end, cue) => Math.max(end, cue.endTime), 0);
    const translatedUntil = firstMissing ? Math.max(time, firstMissing.startTime) : episodeEnd;
    return {
      playbackTime: time,
      translatedUntil,
      bufferSeconds: Math.max(0, translatedUntil - time),
      targetBufferSeconds: this.config.targetBufferSeconds ?? 300,
      completedChunks: this.chunks.filter((chunk) => chunk.state === 'completed').length,
      totalChunks: this.chunks.length,
      failedChunks: this.chunks.filter((chunk) => chunk.state === 'failed').length,
      chunks: this.chunks.map(({ index, startTime, endTime, state, attempts }) => ({
        index,
        startTime,
        endTime,
        state,
        attempts,
      })),
    };
  }

  async run(
    cues: SubtitleCue[],
    context: AnimeContext,
    language: 'ja' | 'en',
    callbacks: TranslationQueueCallbacks,
    signal?: AbortSignal,
  ): Promise<SubtitleCue[]> {
    if (this.running) throw new AppError('QUEUE', '이미 번역 중인 회차입니다.');
    signal?.throwIfAborted();
    if (new Set(cues.map((cue) => cue.id)).size !== cues.length)
      throw new AppError('ID', '원본 자막 ID가 중복됩니다.');
    this.running = true;
    this.callbacks = callbacks;
    this.episodeSignal = signal;
    this.bootstrapReady = false;
    // Sorting copies the array, never modifies cue IDs, timecodes, or the caller's input.
    this.source = [...cues].sort((a, b) => a.startTime - b.startTime || a.endTime - b.endTime);
    const abortActive = () => this.active?.controller.abort(signal?.reason);
    signal?.addEventListener('abort', abortActive, { once: true });
    try {
      // Earlier releases cached an entire episode with the caller's original cue order.
      // Valid completed legacy episodes can be split into progressive chunks without an API call.
      const legacyKey = await translationKey(context, JSON.stringify(cues), language, this.config);
      signal?.throwIfAborted();
      await this.prepare(context, language, signal);
      this.emitState();
      const legacyRaw = await this.cache.get<TranslatedCue[]>(legacyKey);
      signal?.throwIfAborted();
      let legacy: Map<number, string> | undefined;
      if (legacyRaw) {
        try {
          legacy = new Map(
            validateTranslations(this.source, legacyRaw).map(({ id, text }) => [id, text]),
          );
        } catch {
          // Incomplete or corrupt legacy entries cannot replace individually verified chunks.
        }
      }
      // Hydrate every chunk first so a seek can immediately reuse its cached area.
      const cached = legacy
        ? this.chunks.map((chunk) => chunk.source.map(({ id }) => ({ id, text: legacy!.get(id)! })))
        : await Promise.all(this.chunks.map((chunk) => this.cache.get<TranslatedCue[]>(chunk.key)));
      signal?.throwIfAborted();
      for (let i = 0; i < this.chunks.length; i++) {
        if (!cached[i]) continue;
        const chunk = this.chunks[i];
        let part: TranslatedCue[];
        try {
          part = validateTranslations(chunk.source, cached[i]);
        } catch {
          // A corrupt/incompatible cached response is a miss for this chunk only.
          continue;
        }
        if (legacy) {
          await this.cache.put(chunk.key, part);
          signal?.throwIfAborted();
        }
        this.complete(chunk, part);
        signal?.throwIfAborted();
        await callbacks.onChunk(chunk.translated!, this.snapshot());
        signal?.throwIfAborted();
        this.emitState();
      }
      for (;;) {
        signal?.throwIfAborted();
        const chunk = this.chooseChunk();
        if (!chunk) break;
        const active: ActiveRequest = {
          chunk,
          controller: new AbortController(),
          preempted: false,
        };
        this.active = active;
        chunk.state = 'translating';
        this.emitState();
        let part: TranslatedCue[] | undefined;
        try {
          part = await this.translateChunk(chunk, language, active.controller.signal);
          active.controller.signal.throwIfAborted();
          signal?.throwIfAborted();
          // Once the API response is complete, keep its useful result even if playback moves
          // while IndexedDB saves it. Seek cancellation applies to the in-flight API only.
          if (this.active === active) this.active = undefined;
          await this.cache.put(chunk.key, part);
          signal?.throwIfAborted();
        } catch (error) {
          signal?.throwIfAborted();
          if (active.preempted) chunk.state = 'pending';
          else {
            chunk.state = 'failed';
            log('TranslationQueue', { chunk: chunk.index + 1, failed: true });
          }
        } finally {
          if (this.active === active) this.active = undefined;
        }
        if (chunk.state === 'translating' && part) {
          this.complete(chunk, part);
          signal?.throwIfAborted();
          await callbacks.onChunk(chunk.translated!, this.snapshot());
          signal?.throwIfAborted();
          log('TranslationQueue', {
            chunk: chunk.index + 1,
            total: this.chunks.length,
            inputCues: chunk.source.length,
            outputCues: part.length,
          });
        }
        this.emitState();
      }
      signal?.throwIfAborted();
      // Exhausting retries leaves that chunk failed; unrelated chunks still become available.
      return this.chunks.flatMap((chunk) => chunk.translated ?? []);
    } finally {
      signal?.removeEventListener('abort', abortActive);
      this.active = undefined;
      this.callbacks = undefined;
      this.running = false;
    }
  }

  private async prepare(context: AnimeContext, language: 'ja' | 'en', signal?: AbortSignal) {
    const initialCount = Math.min(this.config.initialChunkSize ?? 20, this.config.chunkSize);
    const first = chunkCues(this.source, initialCount, this.config.maxCharacters)[0] ?? [];
    const parts = first.length
      ? [
          first,
          ...chunkCues(
            this.source.slice(first.length),
            this.config.chunkSize,
            this.config.maxCharacters,
          ),
        ]
      : [];
    const root =
      'progressive:v1:' +
      (await translationKey(context, JSON.stringify(this.source), language, this.config)) +
      ':initial:' +
      initialCount;
    signal?.throwIfAborted();
    let offset = 0;
    this.chunks = [];
    for (let index = 0; index < parts.length; index++) {
      const source = parts[index];
      const previousContext = this.previousContext(offset);
      const key =
        root +
        ':chunk:' +
        (await subtitleHash(JSON.stringify({ input: this.input(source), previousContext })));
      signal?.throwIfAborted();
      this.chunks.push({
        index,
        offset,
        source,
        startTime: Math.min(...source.map((cue) => cue.startTime)),
        endTime: Math.max(...source.map((cue) => cue.endTime)),
        state: 'pending',
        attempts: 0,
        key,
      });
      offset += source.length;
    }
  }

  private input(cues: SubtitleCue[]): TranslationCue[] {
    return cues.map(({ id, text }) => ({ id, text }));
  }

  private previousContext(offset: number): TranslationCue[] {
    return this.input(this.source.slice(Math.max(0, offset - this.config.contextCues), offset));
  }

  private chooseChunk(includeTranslating = false): QueueChunk | undefined {
    const unfinished = this.chunks.filter(
      (chunk) => chunk.state === 'pending' || (includeTranslating && chunk.state === 'translating'),
    );
    const bootstrap = unfinished.find((chunk) => chunk.index === 0);
    if (!this.bootstrapReady && bootstrap) return bootstrap;
    // First fill the current playback area and its contiguous forward buffer. Once that region
    // is ready, work through all remaining chunks in chronological order, including earlier holes.
    const bufferEnd = this.playbackTime + (this.config.targetBufferSeconds ?? 300);
    return (
      unfinished.find(
        (chunk) => chunk.endTime > this.playbackTime && chunk.startTime <= bufferEnd,
      ) ?? unfinished[0]
    );
  }

  private complete(chunk: QueueChunk, translated: TranslatedCue[]): void {
    chunk.translated = chunk.source.map((cue, i) => ({ ...cue, text: translated[i].text }));
    chunk.state = 'completed';
    if (chunk.index === 0) this.bootstrapReady = true;
  }

  private emitState(): void {
    if (!this.episodeSignal?.aborted) this.callbacks?.onState(this.snapshot());
  }

  private async translateChunk(
    chunk: QueueChunk,
    language: 'ja' | 'en',
    signal: AbortSignal,
  ): Promise<TranslatedCue[]> {
    const input = this.input(chunk.source);
    const previousContext = this.previousContext(chunk.offset);
    for (let failures = 0; ; failures++) {
      signal.throwIfAborted();
      chunk.attempts++;
      this.emitState();
      try {
        const raw = await this.provider.translate(input, {
          sourceLanguage: language,
          previousContext,
          // Raw context is deterministic. Never key a chunk on another chunk's translated text.
          signal,
        });
        signal.throwIfAborted();
        try {
          return validateTranslations(input, raw);
        } catch {
          throw new AppError('TRANSLATION_FORMAT', '번역 응답 형식이 잘못되었습니다.', true);
        }
      } catch (error) {
        signal.throwIfAborted();
        if (failures >= this.config.maxRetry || (error instanceof AppError && !error.retryable))
          throw error;
        await this.retryDelay(Math.min(500 * 2 ** failures, 4000), signal);
      }
    }
  }

  private retryDelay(milliseconds: number, signal: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      signal.throwIfAborted();
      const onAbort = () => {
        clearTimeout(timer);
        reject(signal.reason);
      };
      const timer = setTimeout(() => {
        signal.removeEventListener('abort', onAbort);
        resolve();
      }, milliseconds);
      signal.addEventListener('abort', onAbort, { once: true });
    });
  }
}
