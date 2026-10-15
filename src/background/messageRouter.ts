import type { AnimeContext } from '../anime/AnimeContext';
import { contextKey, episodeKey, siteAnimeId } from '../anime/AnimeContext';
import type { SubtitleCue } from '../subtitle/SubtitleCue';
import { getSettings, type Settings } from '../storage/settings';
import {
  SubtitleCore,
  SelectionRequired,
  type CoreStatus,
  type Mode,
} from '../subtitle/SubtitleCore';
import type { TranslationQueue, TranslationBufferStatus } from '../translation/TranslationQueue';
import { createProviders } from '../providers/createProviders';
import { resolveAnime } from '../anime/AnimeResolver';
import { errorText } from '../utils/errors';
import { setDebug, log } from '../utils/logger';
import { getOffset } from '../storage/offsets';
import { EpisodeCache, episodeCacheKey } from '../subtitle/EpisodeCache';
import { secondaryJapanese, type JapaneseStatus } from '../subtitle/SecondaryJapanese';
import { settleWorkClock } from './jobClock';
import {
  AUTO_RETRY_WINDOW_MS,
  AUTO_RETRY_DELAYS_MS,
  PLAYER_CHECK_MS,
  nextRetry,
  type AutoEpisode,
} from './autoRetry';
import { AppError } from '../utils/errors';
import {
  applyCues,
  injectFrames,
  clearFrames,
  collectSubtitles,
  videoFrames,
  supportedSite,
  sendVideoMessage,
} from './frameManager';

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
interface Job {
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
const jobs = new Map<number, Job>();
const epochs = new Map<number, number>();
const lifecycle = new Map<number, Promise<void>>();
const navigationTimers = new Map<number, ReturnType<typeof setTimeout>>();
const autoEpisodes = new Map<number, AutoEpisode>();
const episodeCache = new EpisodeCache();
function exclusive<T>(tabId: number, action: () => Promise<T>): Promise<T> {
  const next = (lifecycle.get(tabId) ?? Promise.resolve()).then(action, action);
  const settled = next.then(
    () => {},
    () => {},
  );
  lifecycle.set(tabId, settled);
  void settled.then(() => {
    if (lifecycle.get(tabId) === settled) lifecycle.delete(tabId);
  });
  return next;
}
function clearNavigationTimer(tabId: number) {
  const timer = navigationTimers.get(tabId);
  if (timer !== undefined) clearTimeout(timer);
  navigationTimers.delete(tabId);
}
async function nextEpoch(tabId: number) {
  const stored = await chrome.storage.session.get('epoch:' + tabId);
  const epoch = Math.max(epochs.get(tabId) ?? 0, Number(stored['epoch:' + tabId]) || 0) + 1;
  epochs.set(tabId, epoch);
  await chrome.storage.session.set({ ['epoch:' + tabId]: epoch });
  return epoch;
}
export const isSite = supportedSite;
export function trustedUI(sender: chrome.runtime.MessageSender) {
  return (
    sender.id === chrome.runtime.id &&
    !!sender.url &&
    [chrome.runtime.getURL('popup.html'), chrome.runtime.getURL('settings.html')].some(
      (u) => sender.url!.split('?')[0] === u,
    )
  );
}
function active(tabId: number, j: Job) {
  return jobs.get(tabId) === j && !j.controller.signal.aborted;
}
function uiStatus(status: JobStatus): JobStatus {
  return { ...status, results: status.results?.map(({ downloadUrl: _, ...r }) => r) };
}
function enqueue(tabId: number, j: Job, action: () => Promise<void>) {
  const next = j.writes.then(async () => {
    if (active(tabId, j)) await action();
  });
  j.writes = next.catch(() => {});
  return next;
}
function publish(tabId: number, j: Job, s: CoreStatus) {
  if (!active(tabId, j)) return Promise.resolve();
  j.status = settleWorkClock({ ...j.status, ...s, updatedAt: Date.now() });
  const status = uiStatus(j.status);
  return enqueue(tabId, j, async () => {
    await chrome.storage.session.set({ ['job:' + tabId]: status });
    if (status.translation)
      await sendVideoMessage(tabId, {
        type: 'TRANSLATION_STATUS',
        epoch: status.epoch,
        translation: status.translation,
        stage: status.stage,
        message: status.message,
      });
  });
}
function renderSnapshot(j: Job) {
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
function persistRender(tabId: number, j: Job) {
  const snapshot = renderSnapshot(j);
  return enqueue(tabId, j, async () => {
    await chrome.storage.session.set({ ['render:' + tabId]: snapshot });
    if (j.cues.length && j.status.source)
      await episodeCache.put(j.cacheKey, {
        context: j.status.context,
        cues: j.cues,
        originalCues: j.originalCues,
        japaneseCues: j.japaneseCues,
        japaneseSource: j.japaneseSource,
        language: j.sourceLanguage ?? 'ko',
        source: j.status.source,
        path: j.status.path,
        translation: j.status.translation,
        complete:
          j.status.stage === 'done' ||
          !!(
            j.status.translation &&
            !j.status.translation.failedChunks &&
            j.status.translation.completedChunks === j.status.translation.totalChunks
          ),
      });
  });
}
async function japaneseStatus(tabId: number, j: Job, status: JapaneseStatus) {
  if (!active(tabId, j) || (status.state !== 'off' && !j.settings.display.showJapanese)) return;
  j.status.japanese = status;
  await publish(tabId, j, { stage: j.status.stage, message: j.status.message });
}
async function sendJapanese(tabId: number, j: Job) {
  await persistRender(tabId, j);
  if (active(tabId, j))
    await sendVideoMessage(tabId, {
      type: 'JAPANESE_CUES',
      epoch: j.status.epoch,
      cues: j.japaneseCues ?? [],
    });
}
function ensureJapanese(tabId: number, j: Job) {
  if (!active(tabId, j) || !j.settings.display.showJapanese) return;
  if (j.japaneseCues?.length) {
    if (j.status.japanese?.state === 'ready') return;
    void (async () => {
      await sendJapanese(tabId, j);
      await japaneseStatus(tabId, j, {
        state: 'ready',
        source: j.japaneseSource,
        message: '일본어 원문 함께 표시 중',
      });
    })();
    return;
  }
  if (j.japaneseController) return;
  const controller = new AbortController();
  j.japaneseController = controller;
  const abort = () => controller.abort();
  j.controller.signal.addEventListener('abort', abort, { once: true });
  void (async () => {
    try {
      await japaneseStatus(tabId, j, {
        state: 'searching',
        message: '한국어 자막은 유지하며 일본어 원문을 찾는 중…',
      });
      const skipExternal =
        j.status.mode === 'auto' &&
        j.sourceLanguage === 'en' &&
        j.settings.autoSources.japaneseTranslation;
      const result = await secondaryJapanese(
        j.status.context,
        createProviders(j.settings, controller.signal),
        controller.signal,
        () => collectSubtitles(tabId),
        skipExternal,
      );
      if (!active(tabId, j) || controller.signal.aborted || j.japaneseController !== controller)
        return;
      if (result) {
        j.japaneseCues = result.cues;
        j.japaneseSource = result.source;
        await sendJapanese(tabId, j);
        await japaneseStatus(tabId, j, {
          state: 'ready',
          source: result.source,
          message: '일본어 원문 함께 표시 중',
        });
      } else {
        await japaneseStatus(tabId, j, {
          state: 'unavailable',
          message: '이 회차의 일본어 원문 자막을 찾지 못했습니다. 한국어 자막은 계속 표시합니다.',
        });
      }
    } catch {
      if (active(tabId, j) && !controller.signal.aborted)
        await japaneseStatus(tabId, j, {
          state: 'error',
          message: '일본어 추가 자막을 가져오지 못했습니다. 한국어 자막은 계속 표시합니다.',
        });
    } finally {
      j.controller.signal.removeEventListener('abort', abort);
      if (j.japaneseController === controller) j.japaneseController = undefined;
    }
  })();
}
async function setBusy(tabId: number, busy: boolean, epoch: number) {
  const frames = await chrome.webNavigation.getAllFrames({ tabId }).catch(() => []);
  await Promise.allSettled(
    (frames ?? []).map((f) =>
      chrome.tabs.sendMessage(tabId, { type: 'BUSY', busy, epoch }, { frameId: f.frameId }),
    ),
  );
}
async function releaseBootstrap(tabId: number, j: Job) {
  if (!active(tabId, j) || j.bootstrapReady) return;
  j.bootstrapReady = true;
  await persistRender(tabId, j);
  if (active(tabId, j))
    await sendVideoMessage(tabId, { type: 'BOOTSTRAP_READY', epoch: j.status.epoch });
}
function updateCachedPlayback(j: Job, time: number) {
  if (j.queue || !j.status.translation) return;
  const status = j.status.translation;
  status.playbackTime = time;
  status.bufferSeconds = Math.max(0, status.translatedUntil - time);
}
async function readPlayback(tabId: number, j: Job) {
  const state = await chrome.tabs
    .sendMessage(tabId, { type: 'PLAYBACK' }, { frameId: j.primaryFrame })
    .catch(() => null);
  if (
    active(tabId, j) &&
    state?.ok &&
    Number.isFinite(state.currentTime) &&
    state.currentTime >= 0
  ) {
    j.playbackTime = state.currentTime;
    j.status.playbackTime = state.currentTime;
    j.queue?.updatePlayback(state.currentTime);
    updateCachedPlayback(j, state.currentTime);
  }
}
export async function reportPlayback(
  tabId: number,
  sender: chrome.runtime.MessageSender,
  m: { epoch: number; currentTime: number; seek?: boolean },
) {
  const j = jobs.get(tabId);
  if (
    !j ||
    !active(tabId, j) ||
    sender.frameId !== j.primaryFrame ||
    (j.primaryDocument && sender.documentId !== j.primaryDocument) ||
    Number(m.epoch) !== j.status.epoch ||
    !Number.isFinite(m.currentTime) ||
    m.currentTime < 0 ||
    m.currentTime > 31 * 86400
  )
    return;
  j.playbackTime = m.currentTime;
  j.status.playbackTime = m.currentTime;
  j.queue?.updatePlayback(m.currentTime, m.seek === true);
  updateCachedPlayback(j, m.currentTime);
  if (j.queue)
    await publish(tabId, j, {
      stage: j.status.stage,
      message: j.status.message,
      translation: j.queue.snapshot(),
    });
}
export async function currentStatus(tabId: number): Promise<JobStatus | undefined> {
  const j = jobs.get(tabId);
  if (j) {
    await readPlayback(tabId, j);
    if (j.queue) {
      j.status.translation = j.queue.snapshot();
    }
    if (jobs.get(tabId) !== j) return currentStatus(tabId);
    return uiStatus(j.status);
  }
  const r = await chrome.storage.session.get('job:' + tabId);
  const stored = r['job:' + tabId] as JobStatus | undefined;
  return stored && (stored.busy || stored.japanese?.state === 'searching')
    ? settleWorkClock<JobStatus>(
        {
          ...stored,
          busy: false,
          stage: 'interrupted',
          message:
            '브라우저가 작업을 중단했습니다. 다시 적용하면 완료된 Chunk 캐시부터 이어집니다.',
          japanese:
            stored.japanese?.state === 'searching'
              ? {
                  state: 'error',
                  message:
                    '일본어 추가 자막 검색이 중단되었습니다. 옵션을 다시 켜거나 다시 검색하세요.',
                }
              : stored.japanese,
        },
        stored.updatedAt,
      )
    : stored;
}
async function startJobInternal(
  tabId: number,
  mode: Mode,
  override?: AnimeContext,
  selectedId?: string,
  automatic?: AutoEpisode,
  refresh = false,
) {
  const tab = await chrome.tabs.get(tabId);
  if (!isSite(tab.url)) throw Error('Miruro 또는 Re:ANIME 영상 페이지에서 사용하세요.');
  if (!['ko', 'ja', 'en', 'auto'].includes(mode)) throw Error('자막 모드를 확인하세요.');
  const previous = jobs.get(tabId);
  const selected = selectedId
    ? previous?.status.results?.find((r) => r.id === selectedId)
    : undefined;
  if (selectedId && !selected) throw Error('후보가 만료되었습니다. 다시 검색하세요.');
  const response = override
    ? undefined
    : await chrome.tabs.sendMessage(tabId, { type: 'CONTEXT' }, { frameId: 0 });
  const detected = override ?? (response?.context as AnimeContext | undefined);
  if (
    !detected ||
    !detected.title?.trim() ||
    !Number.isFinite(detected.episode) ||
    detected.episode <= 0
  )
    throw Error(response?.error ?? '작품명과 회차를 확인하세요.');
  const s = await getSettings();
  if (mode === 'auto' && !automatic) {
    automatic = {
      key: episodeKey(detected),
      context: detected,
      startedAt: Date.now(),
      deadlineAt: Date.now() + AUTO_RETRY_WINDOW_MS,
      attempt: 1,
    };
    autoEpisodes.set(tabId, automatic);
  }
  const frames = await videoFrames(tabId);
  if (!frames.length)
    throw new AppError(
      'VIDEO',
      '영상 플레이어를 기다리고 있습니다. 사이트 서버 상태도 확인하세요.',
    );
  if (previous) await cancelJobInternal(tabId, false);
  const epoch = await nextEpoch(tabId);
  await clearFrames(tabId, epoch);
  const j: Job = {
    controller: new AbortController(),
    cues: [],
    settings: s,
    writes: Promise.resolve(),
    primaryFrame: frames[0].frameId,
    primaryDocument: frames[0].documentId,
    playbackTime: 0,
    bootstrapReady: false,
    cacheKey: episodeCacheKey(detected, s, mode),
    automatic,
    status: {
      jobId: crypto.randomUUID(),
      context: detected,
      mode,
      busy: true,
      epoch,
      offset: await getOffset(detected),
      updatedAt: Date.now(),
      stage: 'context',
      message: '작품 정보 인식 중...',
      episodeKey: episodeKey(detected),
      startedAt: automatic?.startedAt ?? Date.now(),
      workElapsedMs: automatic ? Math.max(0, Date.now() - automatic.startedAt) : 0,
      workActiveSince: Date.now(),
      japanese: { state: 'off', message: '일본어 추가 자막 꺼짐' },
      playbackTime: 0,
      retry: automatic
        ? {
            attempt: automatic.attempt,
            maxAttempts: AUTO_RETRY_DELAYS_MS.length + 1,
            deadlineAt: automatic.deadlineAt,
          }
        : undefined,
    },
  };
  jobs.set(tabId, j);
  await chrome.storage.session.set({ ['follow:' + tabId]: { mode, enabled: true } });
  await publish(tabId, j, { stage: 'context', message: '작품 정보 인식 중...' });
  await setBusy(tabId, true, epoch);
  void (async () => {
    try {
      setDebug(s.debug);
      const cached = selected || refresh ? undefined : await episodeCache.get(j.cacheKey);
      j.controller.signal.throwIfAborted();
      if (!active(tabId, j)) return;
      if (cached) {
        j.status.context = { ...cached.context, pageUrl: detected.pageUrl };
        j.status.offset = await getOffset(cached.context);
        j.status.source = cached.source;
        j.status.path = cached.path;
        j.status.cached = true;
        j.cues = cached.cues;
        j.sourceLanguage = cached.language === 'ko' ? undefined : cached.language;
        j.originalCues = cached.originalCues;
        j.japaneseCues =
          cached.japaneseCues ?? (cached.language === 'ja' ? cached.originalCues : undefined);
        j.japaneseSource =
          cached.japaneseSource ?? (cached.language === 'ja' ? cached.source : undefined);
        j.status.translation = cached.translation;
        j.bootstrapReady = true;
        await applyCues(tabId, j.cues, s.display, j.status.offset, epoch);
        await publish(tabId, j, {
          stage: cached.complete ? 'done' : 'translate',
          message: cached.complete
            ? '저장된 한국어 자막을 바로 적용했습니다.'
            : '저장된 자막 적용 · 나머지 번역을 이어갑니다.',
        });
        await persistRender(tabId, j);
        ensureJapanese(tabId, j);
        if (cached.complete) {
          j.status.busy = false;
          await publish(tabId, j, {
            stage: 'done',
            message: '저장된 한국어 자막을 바로 적용했습니다.',
          });
          return;
        }
      }
      const c = cached ? j.status.context : await resolveAnime(detected, j.controller.signal);
      j.controller.signal.throwIfAborted();
      if (!active(tabId, j)) return;
      j.status.context = c;
      j.status.offset = await getOffset(c);
      log('Context', { site: c.site, episode: c.episode, anilistId: c.anilistId });
      const core = new SubtitleCore(
        mode === 'en' ? [] : createProviders(s, j.controller.signal),
        s,
        (st) => {
          void publish(tabId, j, st);
          if (st.translation?.chunks[0]?.state === 'failed') void releaseBootstrap(tabId, j);
        },
        j.controller.signal,
        () => collectSubtitles(tabId),
        {
          onSource: async (result) => {
            if (!active(tabId, j)) return;
            j.sourceLanguage = result.language === 'ko' ? undefined : result.language;
            if (result.language === 'ja') {
              j.japaneseCues = result.cues;
              j.japaneseSource = result.source;
            }
            ensureJapanese(tabId, j);
          },
          onStart: async (original, language, queue) => {
            if (!active(tabId, j)) return;
            j.queue = queue;
            j.sourceLanguage = language;
            j.originalCues = original;
            if (language === 'ja') {
              j.japaneseCues = original;
              j.japaneseSource = j.status.source;
              ensureJapanese(tabId, j);
            }
            await readPlayback(tabId, j);
            await persistRender(tabId, j);
            if (!active(tabId, j)) return;
            if (j.bootstrapReady) return;
            await sendVideoMessage(tabId, {
              type: 'PREPARE',
              epoch,
              immediatePlayback: s.translation.immediatePlayback,
              sourceLanguage: language,
            });
          },
          onChunk: async (delta, snapshot) => {
            if (!active(tabId, j)) return;
            const store = new Map(j.cues.map((cue) => [cue.id, cue]));
            for (const cue of delta) store.set(cue.id, cue);
            j.cues = [...store.values()].sort((a, b) => a.startTime - b.startTime || a.id - b.id);
            j.status.translation = snapshot;
            await persistRender(tabId, j);
            if (!active(tabId, j)) return;
            await sendVideoMessage(tabId, {
              type: 'APPEND',
              cues: delta,
              display: s.display,
              offset: j.status.offset,
              epoch,
            });
            if (snapshot.chunks[0]?.state === 'completed') await releaseBootstrap(tabId, j);
          },
        },
      );
      const cues = await core.run(
        c,
        mode,
        selected,
        cached?.originalCues && cached.language !== 'ko'
          ? { cues: cached.originalCues, language: cached.language, source: cached.source }
          : undefined,
      );
      j.controller.signal.throwIfAborted();
      if (!active(tabId, j)) return;
      if (!j.queue) {
        j.cues = cues;
        j.bootstrapReady = true;
        await applyCues(tabId, cues, s.display, j.status.offset, epoch);
      }
      await releaseBootstrap(tabId, j);
      j.status.busy = false;
      const failures = j.queue?.snapshot().failedChunks ?? 0;
      await publish(tabId, j, {
        stage: failures ? 'partial' : 'done',
        message: failures
          ? '부분 번역 완료 · 실패한 ' +
            failures +
            '개 Chunk는 다시 적용하면 캐시부터 재시도합니다.'
          : '한국어 자막 적용 완료',
        translation: j.queue?.snapshot(),
        results: [],
      });
      await persistRender(tabId, j);
      if (failures && automatic)
        await retryAutomatic(tabId, j, '실패한 번역 구간을 캐시부터 다시 처리합니다.');
    } catch (e) {
      if (!active(tabId, j)) return;
      j.status.busy = false;
      await releaseBootstrap(tabId, j);
      await publish(
        tabId,
        j,
        e instanceof SelectionRequired
          ? {
              stage: 'select',
              message: e.message,
              results: selected
                ? [
                    ...new Map(
                      [...(previous?.status.results ?? []), ...e.results].map((r) => [r.id, r]),
                    ).values(),
                  ]
                : e.results,
            }
          : { stage: 'error', message: errorText(e) },
      );
      if (automatic) {
        if (e instanceof AppError && ['CONFIG', 'HOST_ACCESS'].includes(e.code)) {
          automatic.stopped = true;
          await publish(tabId, j, {
            stage: 'error',
            message: errorText(e) + ' · 설정 또는 수동 모드에서 연결을 확인하세요.',
          });
        } else await retryAutomatic(tabId, j, errorText(e));
      }
    } finally {
      if (active(tabId, j)) await setBusy(tabId, false, j.status.epoch);
    }
  })();
  return uiStatus(j.status);
}
async function persistAutomatic(tabId: number, state: AutoEpisode) {
  await chrome.storage.session.set({ ['automatic:' + tabId]: { ...state } });
}
async function waitingStatus(
  tabId: number,
  state: AutoEpisode,
  stage: string,
  message: string,
  mode: Mode = 'auto',
) {
  const status: JobStatus = settleWorkClock({
    jobId: crypto.randomUUID(),
    context: state.context,
    mode,
    episodeKey: state.key,
    busy: false,
    epoch: epochs.get(tabId) ?? 0,
    offset: 0,
    startedAt: state.startedAt,
    updatedAt: Date.now(),
    stage,
    message,
    retry: {
      attempt: state.attempt,
      maxAttempts: AUTO_RETRY_DELAYS_MS.length + 1,
      nextAt: state.nextAt,
      deadlineAt: state.deadlineAt,
    },
  });
  await chrome.storage.session.set({ ['job:' + tabId]: status });
  await persistAutomatic(tabId, state);
}
function scheduleAutomatic(tabId: number, state: AutoEpisode, delay: number) {
  clearNavigationTimer(tabId);
  state.nextAt = Date.now() + delay;
  const timer = setTimeout(() => {
    void exclusive(tabId, async () => {
      if (
        navigationTimers.get(tabId) !== timer ||
        autoEpisodes.get(tabId) !== state ||
        state.stopped
      )
        return;
      navigationTimers.delete(tabId);
      state.nextAt = undefined;
      await attemptAutomatic(tabId, state);
    });
  }, delay);
  navigationTimers.set(tabId, timer);
}
async function retryAutomatic(tabId: number, j: Job, reason: string) {
  const state = j.automatic;
  if (!state || autoEpisodes.get(tabId) !== state || state.stopped || !active(tabId, j)) return;
  const delay = nextRetry(state);
  if (delay === undefined) {
    state.stopped = true;
    state.nextAt = undefined;
    await publish(tabId, j, {
      stage: j.cues.length ? 'partial' : 'error',
      message: reason + ' · 자동 재시도 종료. 수동 모드 또는 다시 검색을 사용할 수 있습니다.',
    });
  } else {
    scheduleAutomatic(tabId, state, delay);
    j.status.retry = {
      attempt: state.attempt,
      maxAttempts: AUTO_RETRY_DELAYS_MS.length + 1,
      nextAt: state.nextAt,
      deadlineAt: state.deadlineAt,
      reason,
    };
    await publish(tabId, j, {
      stage: 'retry',
      message: '자막 준비 실패 · ' + delay / 1000 + '초 후 자동 재시도합니다.',
    });
  }
  await persistAutomatic(tabId, state);
}
async function attemptAutomatic(tabId: number, state: AutoEpisode) {
  if (autoEpisodes.get(tabId) !== state || state.stopped) return;
  const settings = await getSettings();
  if (settings.mode !== 'auto' || !settings.autoApply) return;
  const existing = jobs.get(tabId);
  if (
    existing?.status.episodeKey === state.key &&
    (existing.status.busy || existing.status.stage === 'done')
  )
    return;
  if (Date.now() >= state.deadlineAt) {
    state.stopped = true;
    await waitingStatus(
      tabId,
      state,
      'error',
      '영상/자막 준비를 2분 동안 확인했습니다. 서버 상태를 확인하거나 수동 모드로 전환하세요.',
    );
    return;
  }
  try {
    if (!(await videoFrames(tabId)).length) {
      state.waiting = true;
      scheduleAutomatic(tabId, state, PLAYER_CHECK_MS);
      await waitingStatus(
        tabId,
        state,
        'waiting-player',
        '영상 플레이어 준비를 기다리는 중 · 자동으로 다시 확인합니다.',
      );
      return;
    }
    state.waiting = false;
    state.nextAt = undefined;
    state.attempt++;
    await persistAutomatic(tabId, state);
    await startJobInternal(tabId, 'auto', state.context, undefined, state);
  } catch (error) {
    if (autoEpisodes.get(tabId) !== state || state.stopped) return;
    if (error instanceof AppError && error.code === 'VIDEO') state.attempt--;
    scheduleAutomatic(tabId, state, PLAYER_CHECK_MS);
    await waitingStatus(
      tabId,
      state,
      'waiting-player',
      '영상 정보/플레이어를 다시 확인합니다. ' + errorText(error),
    );
  }
}
async function cancelJobInternal(tabId: number, stopFollow = true) {
  if (stopFollow) {
    clearNavigationTimer(tabId);
    const automatic = autoEpisodes.get(tabId);
    if (automatic) automatic.stopped = true;
    autoEpisodes.delete(tabId);
    await chrome.storage.session.remove('automatic:' + tabId);
  }
  const j = jobs.get(tabId);
  j?.controller.abort();
  jobs.delete(tabId);
  if (j) await j.writes;
  const epoch = await nextEpoch(tabId);
  await chrome.storage.session.remove(['job:' + tabId, 'render:' + tabId]);
  if (stopFollow) await chrome.storage.session.set({ ['follow:' + tabId]: { enabled: false } });
  await clearFrames(tabId, epoch);
  await setBusy(tabId, false, epoch);
}
export function startJob(
  tabId: number,
  mode: Mode,
  override?: AnimeContext,
  selectedId?: string,
  refresh = false,
) {
  return exclusive(tabId, async () => {
    clearNavigationTimer(tabId);
    const automatic = autoEpisodes.get(tabId);
    if (automatic) automatic.stopped = true;
    autoEpisodes.delete(tabId);
    try {
      return await startJobInternal(tabId, mode, override, selectedId, undefined, refresh);
    } catch (error) {
      const state = autoEpisodes.get(tabId);
      if (mode !== 'auto' || !state || !(error instanceof AppError) || error.code !== 'VIDEO')
        throw error;
      state.attempt = 0;
      await attemptAutomatic(tabId, state);
      const status = await currentStatus(tabId);
      if (!status) throw error;
      return status;
    }
  });
}
export function cancelJob(tabId: number, stopFollow = true) {
  return exclusive(tabId, () => cancelJobInternal(tabId, stopFollow));
}
export function ensureAutomaticJob(tabId: number) {
  return exclusive(tabId, async () => {
    let state = autoEpisodes.get(tabId);
    if (!state) {
      const saved = await chrome.storage.session.get(['automatic:' + tabId, 'job:' + tabId]);
      const restored = saved['automatic:' + tabId] as AutoEpisode | undefined;
      if (!restored || restored.stopped) return;
      const tab = await chrome.tabs.get(tabId);
      const settings = await getSettings();
      const ep = Number(new URL(tab.url ?? 'https://invalid.local').searchParams.get('ep'));
      if (
        !isSite(tab.url) ||
        settings.mode !== 'auto' ||
        !settings.autoApply ||
        siteAnimeId(tab.url ?? '') !== siteAnimeId(restored.context.pageUrl) ||
        (ep > 0 && ep !== restored.context.episode)
      )
        return;
      if ((saved['job:' + tabId] as JobStatus | undefined)?.stage === 'done') return;
      state = restored;
      autoEpisodes.set(tabId, state);
      if (state.nextAt && state.nextAt > Date.now()) {
        scheduleAutomatic(tabId, state, state.nextAt - Date.now());
        return;
      }
    }
    if (state.stopped) return;
    if (navigationTimers.has(tabId) && !state.waiting) return;
    if (state.waiting) clearNavigationTimer(tabId);
    await attemptAutomatic(tabId, state);
  });
}
export function episodeNavigating(tabId: number) {
  return exclusive(tabId, async () => {
    clearNavigationTimer(tabId);
    const automatic = autoEpisodes.get(tabId);
    if (automatic) automatic.stopped = true;
    autoEpisodes.delete(tabId);
    await chrome.storage.session.remove('automatic:' + tabId);
    await cancelJobInternal(tabId, false);
  });
}
export const contextChanged = episodeNavigating;
export function episodeReady(tabId: number, context: AnimeContext, force = false) {
  return exclusive(tabId, async () => {
    const tab = await chrome.tabs.get(tabId);
    if (
      !isSite(tab.url) ||
      !siteAnimeId(tab.url ?? '') ||
      !context.title?.trim() ||
      !(context.episode > 0)
    )
      return;
    if (siteAnimeId(tab.url ?? '') !== siteAnimeId(context.pageUrl)) return;
    const requestedEpisode = Number(new URL(tab.url!).searchParams.get('ep'));
    if (requestedEpisode > 0 && requestedEpisode !== context.episode) return;
    const key = episodeKey(context);
    const manual = jobs.get(tabId)?.status;
    if (
      !force &&
      manual &&
      manual.mode !== 'auto' &&
      manual.context.episode === context.episode &&
      siteAnimeId(manual.context.pageUrl) === siteAnimeId(context.pageUrl)
    )
      return;
    if (
      !force &&
      (autoEpisodes.get(tabId)?.key === key || jobs.get(tabId)?.status.episodeKey === key)
    )
      return;
    clearNavigationTimer(tabId);
    const previous = autoEpisodes.get(tabId);
    if (previous) previous.stopped = true;
    await cancelJobInternal(tabId, false);
    await injectFrames(tabId);
    const settings = await getSettings();
    await chrome.storage.session.set({
      ['follow:' + tabId]: { enabled: true, mode: settings.mode },
    });
    const state: AutoEpisode = {
      key,
      context,
      startedAt: Date.now(),
      deadlineAt: Date.now() + AUTO_RETRY_WINDOW_MS,
      attempt: 0,
    };
    if (settings.mode !== 'auto' || !settings.autoApply) {
      await waitingStatus(
        tabId,
        state,
        'manual',
        '수동 모드 · 사용할 자막 경로를 선택한 뒤 실행하세요.',
        settings.mode,
      );
      return;
    }
    autoEpisodes.set(tabId, state);
    await attemptAutomatic(tabId, state);
  });
}
export async function preferencesChanged() {
  const tabs = await chrome.tabs.query({});
  await Promise.allSettled(
    tabs
      .filter((tab) => tab.id !== undefined && isSite(tab.url))
      .map(async (tab) => {
        await cancelJob(tab.id!);
        const settings = await getSettings();
        if (settings.mode === 'auto' && settings.autoApply) {
          const response = await chrome.tabs
            .sendMessage(tab.id!, { type: 'CONTEXT' }, { frameId: 0 })
            .catch(() => null);
          if (response?.context) await episodeReady(tab.id!, response.context, true);
        }
      }),
  );
}
export async function displayPreferencesChanged() {
  const settings = await getSettings();
  // Completed jobs outlive the MV3 worker in session storage. Restore their existing
  // render state so toggling the extra track never restarts Korean acquisition.
  const tabs = await chrome.tabs.query({});
  for (const tab of tabs) {
    if (tab.id === undefined || !isSite(tab.url) || jobs.has(tab.id)) continue;
    const id = tab.id;
    const stored = await chrome.storage.session.get(['job:' + id, 'render:' + id]);
    const status = stored['job:' + id] as JobStatus | undefined;
    const render = stored['render:' + id] as ReturnType<typeof renderSnapshot> | undefined;
    if (
      !status ||
      !render?.cues.length ||
      status.epoch !== render.epoch ||
      status.busy ||
      status.stage === 'retry' ||
      status.stage === 'waiting-player'
    )
      continue;
    const frames = await videoFrames(id);
    const latest = await chrome.storage.session.get(['epoch:' + id, 'render:' + id]);
    if (
      jobs.has(id) ||
      !latest['render:' + id] ||
      (latest['epoch:' + id] !== undefined && latest['epoch:' + id] !== status.epoch)
    )
      continue;
    const recovered = settleWorkClock<JobStatus>(
      {
        ...status,
        japanese:
          status.japanese?.state === 'searching'
            ? { state: 'error', message: '일본어 검색이 중단되었습니다.' }
            : status.japanese,
      },
      status.updatedAt,
    );
    jobs.set(id, {
      controller: new AbortController(),
      status: structuredClone(recovered),
      cues: render.cues,
      settings: structuredClone(settings),
      primaryFrame: frames[0]?.frameId ?? 0,
      primaryDocument: frames[0]?.documentId,
      playbackTime: status.playbackTime ?? 0,
      bootstrapReady: render.bootstrapReady,
      writes: Promise.resolve(),
      cacheKey: render.cacheKey ?? episodeCacheKey(status.context, settings, status.mode),
      sourceLanguage: render.sourceLanguage,
      originalCues: render.originalCues,
      japaneseCues: render.japaneseCues,
      japaneseSource: render.japaneseSource,
    });
  }
  await Promise.allSettled(
    [...jobs].map(async ([tabId, j]) => {
      if (!active(tabId, j)) return;
      j.settings.display = settings.display;
      await sendVideoMessage(tabId, {
        type: 'DISPLAY',
        epoch: j.status.epoch,
        display: settings.display,
      });
      if (!settings.display.showJapanese) {
        j.japaneseController?.abort();
        j.japaneseController = undefined;
        await japaneseStatus(tabId, j, { state: 'off', message: '일본어 추가 자막 꺼짐' });
      } else if (j.cues.length || j.originalCues?.length || j.japaneseCues?.length)
        ensureJapanese(tabId, j);
      await persistRender(tabId, j);
    }),
  );
}
export async function syncFrame(tabId: number, frameId: number) {
  const j = jobs.get(tabId);
  if (j) {
    const frames = await videoFrames(tabId);
    if (frames[0]) {
      j.primaryFrame = frames[0].frameId;
      j.primaryDocument = frames[0].documentId;
    }
  }
  const data = await chrome.storage.session.get('render:' + tabId);
  const r = data['render:' + tabId] as ReturnType<typeof renderSnapshot> | undefined;
  if (!r) return;
  if (r.sourceLanguage && !r.bootstrapReady)
    await chrome.tabs
      .sendMessage(
        tabId,
        {
          type: 'PREPARE',
          epoch: r.epoch,
          immediatePlayback: r.immediatePlayback,
          sourceLanguage: r.sourceLanguage,
        },
        { frameId },
      )
      .catch(() => {});
  const { originalCues: _original, cacheKey: _cacheKey, ...render } = r;
  await chrome.tabs.sendMessage(tabId, { type: 'APPLY', ...render }, { frameId }).catch(() => {});
  if (r.bootstrapReady)
    await chrome.tabs
      .sendMessage(tabId, { type: 'BOOTSTRAP_READY', epoch: r.epoch }, { frameId })
      .catch(() => {});
  if (r.translation)
    await chrome.tabs
      .sendMessage(
        tabId,
        {
          type: 'TRANSLATION_STATUS',
          epoch: r.epoch,
          translation: r.translation,
          stage: r.stage,
          message: r.message,
        },
        { frameId },
      )
      .catch(() => {});
  if (j?.status.busy && active(tabId, j))
    await chrome.tabs
      .sendMessage(tabId, { type: 'BUSY', busy: true, epoch: j.status.epoch }, { frameId })
      .catch(() => {});
}
export async function updateOffset(tabId: number, value: number) {
  const j = jobs.get(tabId);
  if (j) {
    j.status.offset = value;
    await publish(tabId, j, { stage: j.status.stage, message: j.status.message });
  }
  const r = await chrome.storage.session.get('render:' + tabId);
  if (r['render:' + tabId])
    await chrome.storage.session.set({
      ['render:' + tabId]: { ...(r['render:' + tabId] as object), offset: value },
    });
  const frames = await chrome.webNavigation.getAllFrames({ tabId });
  await Promise.allSettled(
    (frames ?? []).map((f) =>
      chrome.tabs.sendMessage(tabId, { type: 'OFFSET', offset: value }, { frameId: f.frameId }),
    ),
  );
}
chrome.tabs.onRemoved.addListener((id) => {
  const j = jobs.get(id);
  j?.controller.abort();
  jobs.delete(id);
  epochs.delete(id);
  clearNavigationTimer(id);
  autoEpisodes.delete(id);
  void (j?.writes ?? Promise.resolve()).then(() =>
    chrome.storage.session.remove(['job:' + id, 'render:' + id, 'follow:' + id, 'automatic:' + id]),
  );
});
