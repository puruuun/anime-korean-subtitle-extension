import { describe, expect, it, vi } from 'vitest';
import 'fake-indexeddb/auto';
import type { AnimeContext } from '../src/anime/AnimeContext';
import type { SubtitleCue } from '../src/subtitle/SubtitleCue';
import { defaultSettings } from '../src/storage/settings';
import {
  TranslationCache,
  translationKey,
  type TranslationStore,
} from '../src/translation/TranslationCache';
import {
  TranslationQueue,
  type TranslationBufferStatus,
} from '../src/translation/TranslationQueue';
import type {
  TranslatedCue,
  TranslationCue,
  TranslationOptions,
  TranslationProvider,
} from '../src/translation/TranslationProvider';
import { AppError } from '../src/utils/errors';

const context: AnimeContext = {
  site: 'miruro',
  title: 'Progressive queue test',
  episode: 1,
  pageUrl: 'https://www.miruro.to/watch/progressive?ep=1',
};
let modelNumber = 0;
const config = () => ({
  ...defaultSettings.translation,
  model: 'progressive-test-' + ++modelNumber,
  initialChunkSize: 20,
  targetBufferSeconds: 300,
  immediatePlayback: false,
});
const makeCues = (count: number, step = 10): SubtitleCue[] =>
  Array.from({ length: count }, (_, index) => ({
    id: index + 1,
    startTime: index * step,
    endTime: index * step + 5,
    text: 'source line ' + (index + 1),
  }));
const translated = (cues: TranslationCue[]): TranslatedCue[] =>
  cues.map(({ id }) => ({ id, text: '한국어 ' + id }));

class MemoryStore implements TranslationStore {
  values = new Map<string, unknown>();
  async get<T>(key: string): Promise<T | undefined> {
    return this.values.get(key) as T | undefined;
  }
  async put<T>(key: string, value: T): Promise<void> {
    this.values.set(key, structuredClone(value));
  }
}

function controlledProvider() {
  const requests: {
    input: TranslationCue[];
    options: TranslationOptions;
    aborted: boolean;
    resolve: () => void;
  }[] = [];
  let active = 0;
  let peakActive = 0;
  const provider: TranslationProvider = {
    id: 'controlled',
    translate: vi.fn((input: TranslationCue[], options: TranslationOptions) => {
      active++;
      peakActive = Math.max(peakActive, active);
      return new Promise<TranslatedCue[]>((resolve, reject) => {
        let done = false;
        const finish = (action: () => void) => {
          if (done) return;
          done = true;
          active--;
          options.signal?.removeEventListener('abort', onAbort);
          action();
        };
        const onAbort = () => {
          request.aborted = true;
          finish(() => reject(options.signal?.reason));
        };
        const request = {
          input,
          options,
          aborted: false,
          resolve: () => finish(() => resolve(translated(input))),
        };
        requests.push(request);
        options.signal?.addEventListener('abort', onAbort, { once: true });
        if (options.signal?.aborted) onAbort();
      });
    }),
  };
  return { provider, requests, peakActive: () => peakActive };
}
const waitRequests = async (controller: ReturnType<typeof controlledProvider>, count: number) => {
  await vi.waitFor(() => expect(controller.requests).toHaveLength(count));
};

describe('progressive translation queue', () => {
  it('publishes the first 20 cues before later requests finish and preserves IDs and times', async () => {
    const source = makeCues(110);
    const control = controlledProvider();
    const store = new MemoryStore();
    const queue = new TranslationQueue(control.provider, config(), store);
    const published: SubtitleCue[][] = [];
    let finished = false;
    const run = queue
      .run(source, context, 'en', {
        onChunk: (cues) => {
          expect(store.values.size).toBe(published.length + 1);
          published.push(cues);
        },
        onState: () => {},
      })
      .then((result) => {
        finished = true;
        return result;
      });
    await waitRequests(control, 1);
    expect(control.requests[0].input).toHaveLength(20);
    control.requests[0].resolve();
    await waitRequests(control, 2);
    expect(published).toHaveLength(1);
    expect(published[0]).toHaveLength(20);
    expect(finished).toBe(false);
    expect(control.requests[1].input).toHaveLength(45);
    control.requests[1].resolve();
    await waitRequests(control, 3);
    control.requests[2].resolve();
    const result = await run;
    expect(result.map(({ id, startTime, endTime }) => ({ id, startTime, endTime }))).toEqual(
      source.map(({ id, startTime, endTime }) => ({ id, startTime, endTime })),
    );
    expect(result.every((cue) => cue.text === '한국어 ' + cue.id)).toBe(true);
    expect(control.peakActive()).toBe(1);
    expect(queue.snapshot()).toMatchObject({ completedChunks: 3, totalChunks: 3, failedChunks: 0 });
  });

  it('honors character limits and a smaller configured legacy chunk count for bootstrap', async () => {
    for (const settings of [
      { ...config(), chunkSize: 2 },
      { ...config(), maxCharacters: 30 },
    ]) {
      const lengths: number[] = [];
      const queue = new TranslationQueue(
        {
          id: 'small',
          translate: async (input) => {
            lengths.push(input.length);
            return translated(input);
          },
        },
        settings,
        new MemoryStore(),
      );
      await queue.run(makeCues(5), context, 'en', { onChunk: () => {}, onState: () => {} });
      expect(lengths).toEqual([2, 2, 1]);
    }
  });

  it('preempts an irrelevant in-flight chunk after seek and fills the new buffer before old holes', async () => {
    const control = controlledProvider();
    const queue = new TranslationQueue(control.provider, config(), new MemoryStore());
    const published: number[] = [];
    const run = queue.run(makeCues(150), context, 'en', {
      onChunk: (cues) => {
        published.push(cues[0].id);
      },
      onState: () => {},
    });
    await waitRequests(control, 1);
    control.requests[0].resolve();
    await waitRequests(control, 2);
    expect(control.requests[1].input[0].id).toBe(21);
    queue.updatePlayback(1080, true);
    await waitRequests(control, 3);
    expect(control.requests[1].aborted).toBe(true);
    expect(control.requests[2].input[0].id).toBe(66);
    expect(queue.snapshot().chunks[1].state).toBe('pending');
    control.requests[2].resolve();
    await waitRequests(control, 4);
    expect(control.requests[3].input[0].id).toBe(111);
    expect(queue.snapshot()).toMatchObject({ translatedUntil: 1100, bufferSeconds: 20 });
    control.requests[3].resolve();
    await waitRequests(control, 5);
    expect(control.requests[4].input[0].id).toBe(21);
    expect(queue.snapshot()).toMatchObject({ translatedUntil: 1495, bufferSeconds: 415 });
    queue.updatePlayback(0);
    // A completed 18-minute chunk cannot hide the untranslated hole at 3:20.
    expect(queue.snapshot()).toMatchObject({ translatedUntil: 200, bufferSeconds: 200 });
    control.requests[4].resolve();
    const output = await run;
    expect(published).toEqual([1, 66, 111, 21]);
    expect(output.map((cue) => cue.id)).toEqual(makeCues(150).map((cue) => cue.id));
    expect(queue.snapshot().chunks[1]).toMatchObject({ state: 'completed', attempts: 2 });
    expect(control.peakActive()).toBe(1);
  });

  it('does not preempt the small bootstrap request, even when playback starts far ahead', async () => {
    const control = controlledProvider();
    const queue = new TranslationQueue(control.provider, config(), new MemoryStore());
    const abort = new AbortController();
    const run = queue.run(
      makeCues(150),
      context,
      'en',
      { onChunk: () => {}, onState: () => {} },
      abort.signal,
    );
    const cancelled = expect(run).rejects.toMatchObject({ name: 'AbortError' });
    await waitRequests(control, 1);
    queue.updatePlayback(1080, true);
    expect(control.requests[0].aborted).toBe(false);
    expect(control.requests).toHaveLength(1);
    control.requests[0].resolve();
    await waitRequests(control, 2);
    expect(control.requests[1].input[0].id).toBe(66);
    abort.abort();
    await cancelled;
  });

  it('retries only the malformed chunk and uses stable raw source context', async () => {
    const calls: number[] = [];
    const settings = { ...config(), maxRetry: 1 };
    const provider: TranslationProvider = {
      id: 'retry',
      translate: vi.fn(async (input: TranslationCue[], options: TranslationOptions) => {
        expect(input.every((cue) => !('startTime' in cue) && !('endTime' in cue))).toBe(true);
        calls.push(input[0].id);
        if (input[0].id === 21) {
          expect(options.previousContext).toEqual(
            makeCues(110)
              .slice(15, 20)
              .map(({ id, text }) => ({ id, text })),
          );
          expect(options.previousTranslations).toBeUndefined();
          if (calls.filter((id) => id === 21).length === 1) return [{ id: 999, text: 'invalid' }];
        }
        return translated(input);
      }),
    };
    const queue = new TranslationQueue(provider, settings, new MemoryStore());
    const result = await queue.run(makeCues(110), context, 'ja', {
      onChunk: () => {},
      onState: () => {},
    });
    expect(calls).toEqual([1, 21, 21, 66]);
    expect(result).toHaveLength(110);
    expect(queue.snapshot().chunks[1]).toMatchObject({ attempts: 2, state: 'completed' });
  });

  it('marks exhausted chunks failed and continues translating unrelated chunks', async () => {
    const calls: number[] = [];
    const queue = new TranslationQueue(
      {
        id: 'failure',
        translate: async (input) => {
          calls.push(input[0].id);
          if (input[0].id === 21) throw new AppError('CONNECTION', 'temporary failure', true);
          return translated(input);
        },
      },
      { ...config(), maxRetry: 1 },
      new MemoryStore(),
    );
    const result = await queue.run(makeCues(110), context, 'en', {
      onChunk: () => {},
      onState: () => {},
    });
    expect(calls).toEqual([1, 21, 21, 66]);
    expect(result).toHaveLength(65);
    expect(result.some((cue) => cue.id === 66)).toBe(true);
    expect(queue.snapshot()).toMatchObject({ failedChunks: 1, completedChunks: 2, totalChunks: 3 });
    expect(queue.snapshot().chunks[1]).toMatchObject({ attempts: 2, state: 'failed' });
  });

  it('reuses IndexedDB chunks after a seek and episode restart regardless of translation order', async () => {
    const settings = config();
    const first = controlledProvider();
    const firstQueue = new TranslationQueue(first.provider, settings, new TranslationCache());
    const abort = new AbortController();
    const run = firstQueue.run(
      makeCues(150),
      context,
      'en',
      { onChunk: () => {}, onState: () => {} },
      abort.signal,
    );
    const cancelled = expect(run).rejects.toMatchObject({ name: 'AbortError' });
    await waitRequests(first, 1);
    first.requests[0].resolve();
    await waitRequests(first, 2);
    firstQueue.updatePlayback(1080, true);
    await waitRequests(first, 3);
    first.requests[2].resolve();
    await waitRequests(first, 4);
    abort.abort();
    await cancelled;
    const reopened = controlledProvider();
    const secondQueue = new TranslationQueue(reopened.provider, settings, new TranslationCache());
    secondQueue.updatePlayback(1080);
    const cachedIds: number[] = [];
    const resumed = secondQueue.run(makeCues(150), context, 'en', {
      onChunk: (cues) => {
        cachedIds.push(cues[0].id);
      },
      onState: () => {},
    });
    await waitRequests(reopened, 1);
    expect(cachedIds).toEqual([1, 66]);
    expect(reopened.requests[0].input[0].id).toBe(111);
    reopened.requests[0].resolve();
    await waitRequests(reopened, 2);
    expect(reopened.requests[1].input[0].id).toBe(21);
    reopened.requests[1].resolve();
    expect(await resumed).toHaveLength(150);
    const noCalls = vi.fn(async () => {
      throw Error('All chunks should already be cached');
    });
    const fullyCached = new TranslationQueue(
      { id: 'cached', translate: noCalls },
      settings,
      new TranslationCache(),
    );
    const result = await fullyCached.run(makeCues(150), context, 'en', {
      onChunk: () => {},
      onState: () => {},
    });
    expect(result).toHaveLength(150);
    expect(noCalls).not.toHaveBeenCalled();
    expect(fullyCached.snapshot().chunks.every((chunk) => chunk.attempts === 0)).toBe(true);
  });

  it('does not publish cues or schedule another request after an episode abort', async () => {
    const control = controlledProvider();
    const queue = new TranslationQueue(control.provider, config(), new MemoryStore());
    const abort = new AbortController();
    const publish = vi.fn();
    const states: TranslationBufferStatus[] = [];
    const run = queue.run(
      makeCues(110),
      context,
      'en',
      { onChunk: publish, onState: (state) => states.push(state) },
      abort.signal,
    );
    const cancelled = expect(run).rejects.toMatchObject({ name: 'AbortError' });
    await waitRequests(control, 1);
    const stateCount = states.length;
    abort.abort();
    control.requests[0].resolve();
    await cancelled;
    expect(control.requests[0].aborted).toBe(true);
    expect(control.requests).toHaveLength(1);
    expect(publish).not.toHaveBeenCalled();
    expect(states).toHaveLength(stateCount);
  });

  it('guards publishing if cancellation happens while a completed chunk is being cached', async () => {
    let finishSave!: () => void;
    const put = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishSave = resolve;
        }),
    );
    const provider = { id: 'cache-race', translate: vi.fn(async (input) => translated(input)) };
    const queue = new TranslationQueue(provider, config(), {
      get: async () => undefined,
      put,
    });
    const abort = new AbortController();
    const publish = vi.fn();
    const run = queue.run(
      makeCues(110),
      context,
      'en',
      { onChunk: publish, onState: () => {} },
      abort.signal,
    );
    const cancelled = expect(run).rejects.toMatchObject({ name: 'AbortError' });
    await vi.waitFor(() => expect(put).toHaveBeenCalledTimes(1));
    abort.abort();
    finishSave();
    await cancelled;
    expect(publish).not.toHaveBeenCalled();
    expect(provider.translate).toHaveBeenCalledTimes(1);
  });

  it('keeps a completed API result when seek happens during its cache write instead of retranslating it', async () => {
    const store = new MemoryStore();
    let finishSave: (() => void) | undefined;
    const cache: TranslationStore = {
      get: (key) => store.get(key),
      put: async (key, value) => {
        if (Array.isArray(value) && value[0]?.id === 21)
          await new Promise<void>((resolve) => {
            finishSave = resolve;
          });
        await store.put(key, value);
      },
    };
    const calls: number[] = [];
    const signals: AbortSignal[] = [];
    const provider: TranslationProvider = {
      id: 'save-seek',
      translate: async (input, options) => {
        calls.push(input[0].id);
        signals.push(options.signal!);
        return translated(input);
      },
    };
    const queue = new TranslationQueue(provider, config(), cache);
    const run = queue.run(makeCues(150), context, 'en', {
      onChunk: () => {},
      onState: () => {},
    });
    await vi.waitFor(() => expect(finishSave).toBeTypeOf('function'));
    queue.updatePlayback(1080, true);
    expect(signals[1].aborted).toBe(false);
    finishSave!();
    expect(await run).toHaveLength(150);
    expect(calls).toEqual([1, 21, 66, 111]);
  });

  it('isolates cached chunk boundaries when the initial chunk size changes', async () => {
    const settings = config();
    const store = new MemoryStore();
    const lengths: number[] = [];
    const provider: TranslationProvider = {
      id: 'boundaries',
      translate: async (input) => {
        lengths.push(input.length);
        return translated(input);
      },
    };
    for (const initialChunkSize of [20, 15]) {
      const queue = new TranslationQueue(provider, { ...settings, initialChunkSize }, store);
      await queue.run(makeCues(60), context, 'en', { onChunk: () => {}, onState: () => {} });
    }
    expect(lengths).toEqual([20, 40, 15, 45]);
  });

  it('migrates a valid legacy whole-episode cache into independent chunks without API calls', async () => {
    const settings = config();
    const source = makeCues(65).reverse();
    const store = new MemoryStore();
    const oldKey = await translationKey(context, JSON.stringify(source), 'en', settings);
    await store.put(oldKey, translated(source));
    const provider = { id: 'legacy-cache', translate: vi.fn(async (input) => translated(input)) };
    const published: number[] = [];
    const queue = new TranslationQueue(provider, settings, store);
    const result = await queue.run(source, context, 'en', {
      onChunk: (delta) => {
        // The new independent cache entry is saved before that chunk becomes visible.
        expect(store.values.size).toBe(published.length + 2);
        published.push(delta[0].id);
      },
      onState: () => {},
    });
    expect(published).toEqual([1, 21]);
    expect(result.map((cue) => cue.id)).toEqual(makeCues(65).map((cue) => cue.id));
    expect(provider.translate).not.toHaveBeenCalled();
    expect(queue.snapshot()).toMatchObject({ completedChunks: 2, failedChunks: 0 });
    store.values.delete(oldKey);
    const reopened = new TranslationQueue(provider, settings, store);
    await reopened.run(source, context, 'en', { onChunk: () => {}, onState: () => {} });
    expect(provider.translate).not.toHaveBeenCalled();
  });

  it('ignores a corrupt legacy whole-episode cache and translates its missing chunks normally', async () => {
    const settings = config();
    const source = makeCues(25);
    const store = new MemoryStore();
    const oldKey = await translationKey(context, JSON.stringify(source), 'en', settings);
    await store.put(oldKey, translated(source.slice(0, 20)));
    const provider = { id: 'bad-legacy', translate: vi.fn(async (input) => translated(input)) };
    const queue = new TranslationQueue(provider, settings, store);
    expect(
      await queue.run(source, context, 'en', { onChunk: () => {}, onState: () => {} }),
    ).toHaveLength(25);
    expect(provider.translate).toHaveBeenCalledTimes(2);
  });

  it('rejects duplicate source IDs before making a translation request', async () => {
    const provider = { id: 'duplicate', translate: vi.fn(async (input) => translated(input)) };
    const queue = new TranslationQueue(provider, config(), new MemoryStore());
    const duplicate = makeCues(2).map((cue) => ({ ...cue, id: 1 }));
    await expect(
      queue.run(duplicate, context, 'en', { onChunk: () => {}, onState: () => {} }),
    ).rejects.toMatchObject({ code: 'ID' });
    expect(provider.translate).not.toHaveBeenCalled();
  });
});
