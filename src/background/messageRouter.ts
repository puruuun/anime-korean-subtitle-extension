import type { AnimeContext } from '../anime/AnimeContext';
import { contextKey } from '../anime/AnimeContext';
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
import {
  applyCues,
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
}
const jobs = new Map<number, Job>();
const epochs = new Map<number, number>();
const lifecycle = new Map<number, Promise<void>>();
const navigationTimers = new Map<number, ReturnType<typeof setTimeout>>();
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
  j.status = { ...j.status, ...s, updatedAt: Date.now() };
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
  });
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
    j.queue?.updatePlayback(state.currentTime);
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
  j.queue?.updatePlayback(m.currentTime, m.seek === true);
  if (j.queue)
    await publish(tabId, j, {
      stage: j.status.stage,
      message: j.status.message,
      translation: j.queue.snapshot(),
    });
}
export async function currentStatus(tabId: number) {
  const j = jobs.get(tabId);
  if (j) {
    if (j.queue) {
      await readPlayback(tabId, j);
      j.status.translation = j.queue.snapshot();
    }
    return uiStatus(j.status);
  }
  const r = await chrome.storage.session.get('job:' + tabId);
  const stored = r['job:' + tabId] as JobStatus | undefined;
  return stored?.busy
    ? {
        ...stored,
        busy: false,
        stage: 'interrupted',
        message: '브라우저가 작업을 중단했습니다. 다시 적용하면 완료된 Chunk 캐시부터 이어집니다.',
      }
    : stored;
}
async function startJobInternal(
  tabId: number,
  mode: Mode,
  override?: AnimeContext,
  selectedId?: string,
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
  const frames = await videoFrames(tabId);
  if (!frames.length)
    throw Error('영상 요소를 찾지 못했습니다. 재생을 시작하고 iframe 접근을 허용하세요.');
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
    },
  };
  jobs.set(tabId, j);
  await chrome.storage.session.set({ ['follow:' + tabId]: { mode, enabled: true } });
  await publish(tabId, j, { stage: 'context', message: '작품 정보 인식 중...' });
  await setBusy(tabId, true, epoch);
  void (async () => {
    try {
      setDebug(s.debug);
      const c = await resolveAnime(detected, j.controller.signal);
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
          onStart: async (_source, language, queue) => {
            if (!active(tabId, j)) return;
            j.queue = queue;
            j.sourceLanguage = language;
            await readPlayback(tabId, j);
            await persistRender(tabId, j);
            if (!active(tabId, j)) return;
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
      const cues = await core.run(c, mode, selected);
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
    } catch (e) {
      if (!active(tabId, j)) return;
      j.status.busy = false;
      await releaseBootstrap(tabId, j);
      await publish(
        tabId,
        j,
        e instanceof SelectionRequired
          ? { stage: 'select', message: e.message, results: e.results }
          : { stage: 'error', message: errorText(e) },
      );
    } finally {
      if (active(tabId, j)) await setBusy(tabId, false, j.status.epoch);
    }
  })();
  return uiStatus(j.status);
}
async function cancelJobInternal(tabId: number, stopFollow = true) {
  if (stopFollow) clearNavigationTimer(tabId);
  const j = jobs.get(tabId);
  j?.controller.abort();
  jobs.delete(tabId);
  if (j) await j.writes;
  const epoch = await nextEpoch(tabId);
  await chrome.storage.session.remove(['job:' + tabId, 'render:' + tabId]);
  if (stopFollow) await chrome.storage.session.remove('follow:' + tabId);
  await clearFrames(tabId, epoch);
  await setBusy(tabId, false, epoch);
}
export function startJob(tabId: number, mode: Mode, override?: AnimeContext, selectedId?: string) {
  return exclusive(tabId, async () => {
    clearNavigationTimer(tabId);
    return startJobInternal(tabId, mode, override, selectedId);
  });
}
export function cancelJob(tabId: number, stopFollow = true) {
  return exclusive(tabId, () => cancelJobInternal(tabId, stopFollow));
}
export function contextChanged(tabId: number) {
  return exclusive(tabId, async () => {
    clearNavigationTimer(tabId);
    const state = await chrome.storage.session.get('follow:' + tabId);
    await cancelJobInternal(tabId, false);
    const follow = state['follow:' + tabId] as { mode: Mode; enabled: boolean } | undefined;
    if (!follow?.enabled) return;
    const timer = setTimeout(() => {
      void exclusive(tabId, async () => {
        if (navigationTimers.get(tabId) !== timer) return;
        navigationTimers.delete(tabId);
        const state = await chrome.storage.session.get('follow:' + tabId);
        const f = state['follow:' + tabId] as { enabled: boolean; mode: Mode } | undefined;
        if (!f?.enabled) return;
        try {
          await startJobInternal(tabId, f.mode);
        } catch (e) {
          await chrome.storage.session.set({
            ['job:' + tabId]: {
              busy: false,
              stage: 'error',
              message: errorText(e),
              mode: f.mode,
              offset: 0,
              updatedAt: Date.now(),
            },
          });
        }
      });
    }, 800);
    navigationTimers.set(tabId, timer);
  });
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
  await chrome.tabs.sendMessage(tabId, { type: 'APPLY', ...r }, { frameId }).catch(() => {});
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
  void (j?.writes ?? Promise.resolve()).then(() =>
    chrome.storage.session.remove(['job:' + id, 'render:' + id, 'follow:' + id]),
  );
});
