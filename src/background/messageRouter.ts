import type { AnimeContext } from '../anime/AnimeContext';
import { contextKey } from '../anime/AnimeContext';
import type { SubtitleCue } from '../subtitle/SubtitleCue';
import { getSettings } from '../storage/settings';
import {
  SubtitleCore,
  SelectionRequired,
  type CoreStatus,
  type Mode,
} from '../subtitle/SubtitleCore';
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
  cues?: SubtitleCue[];
}
const jobs = new Map<number, Job>();
const epochs = new Map<number, number>();
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
function uiStatus(status: JobStatus): JobStatus {
  return { ...status, results: status.results?.map(({ downloadUrl: _, ...r }) => r) };
}
async function publish(tabId: number, j: Job, s: CoreStatus) {
  if (jobs.get(tabId) !== j) return;
  j.status = { ...j.status, ...s, updatedAt: Date.now() };
  await chrome.storage.session.set({ ['job:' + tabId]: uiStatus(j.status) });
}
export async function currentStatus(tabId: number) {
  const j = jobs.get(tabId);
  if (j) return uiStatus(j.status);
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
export async function startJob(
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
  if (!(await videoFrames(tabId).then((f) => f.length)))
    throw Error('영상 요소를 찾지 못했습니다. 재생을 시작하고 iframe 접근을 허용하세요.');
  previous?.controller.abort();
  const epoch = await nextEpoch(tabId);
  await clearFrames(tabId, epoch);
  const offset = await getOffset(detected);
  const j: Job = {
    controller: new AbortController(),
    status: {
      jobId: crypto.randomUUID(),
      context: detected,
      mode,
      busy: true,
      epoch,
      offset,
      updatedAt: Date.now(),
      stage: 'context',
      message: '작품 정보 인식 중...',
    },
  };
  jobs.set(tabId, j);
  await chrome.storage.session.set({ ['follow:' + tabId]: { mode, enabled: true } });
  await publish(tabId, j, { stage: 'context', message: '작품 정보 인식 중...' });
  await chrome.tabs
    .sendMessage(tabId, { type: 'BUSY', busy: true }, { frameId: 0 })
    .catch(() => {});
  void (async () => {
    try {
      setDebug(s.debug);
      const c = await resolveAnime(detected, j.controller.signal);
      j.status.context = c;
      j.status.offset = await getOffset(c);
      log('Context', { site: c.site, episode: c.episode, anilistId: c.anilistId });
      const core = new SubtitleCore(
        mode === 'en' ? [] : createProviders(s, j.controller.signal),
        s,
        (st) => {
          void publish(tabId, j, st);
        },
        j.controller.signal,
        () => collectSubtitles(tabId),
      );
      const cues = await core.run(c, mode, selected);
      j.controller.signal.throwIfAborted();
      if (jobs.get(tabId) !== j) return;
      await applyCues(tabId, cues, s.display, j.status.offset, epoch);
      j.cues = cues;
      await chrome.storage.session.set({
        ['render:' + tabId]: {
          cues,
          display: s.display,
          offset: j.status.offset,
          epoch,
          contextKey: contextKey(c),
        },
      });
      j.status.busy = false;
      await publish(tabId, j, { stage: 'done', message: '한국어 자막 적용 완료', results: [] });
    } catch (e) {
      if (j.controller.signal.aborted || jobs.get(tabId) !== j) return;
      j.status.busy = false;
      await publish(
        tabId,
        j,
        e instanceof SelectionRequired
          ? { stage: 'select', message: e.message, results: e.results }
          : { stage: 'error', message: errorText(e) },
      );
    } finally {
      if (jobs.get(tabId) === j)
        await chrome.tabs
          .sendMessage(tabId, { type: 'BUSY', busy: false }, { frameId: 0 })
          .catch(() => {});
    }
  })();
  return uiStatus(j.status);
}
export async function cancelJob(tabId: number, stopFollow = true) {
  const j = jobs.get(tabId);
  j?.controller.abort();
  jobs.delete(tabId);
  const epoch = await nextEpoch(tabId);
  await chrome.storage.session.remove(['job:' + tabId, 'render:' + tabId]);
  if (stopFollow) await chrome.storage.session.remove('follow:' + tabId);
  await clearFrames(tabId, epoch);
  await chrome.tabs
    .sendMessage(tabId, { type: 'BUSY', busy: false }, { frameId: 0 })
    .catch(() => {});
}
export async function contextChanged(tabId: number) {
  const state = await chrome.storage.session.get('follow:' + tabId);
  await cancelJob(tabId, false);
  const follow = state['follow:' + tabId] as { mode: Mode; enabled: boolean } | undefined;
  if (follow?.enabled)
    setTimeout(() => {
      void chrome.storage.session.get('follow:' + tabId).then(async (r) => {
        const f = r['follow:' + tabId] as { enabled: boolean; mode: Mode } | undefined;
        if (f?.enabled)
          try {
            await startJob(tabId, f.mode);
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
}
export async function syncFrame(tabId: number, frameId: number) {
  const data = await chrome.storage.session.get('render:' + tabId);
  const r = data['render:' + tabId];
  if (r)
    await chrome.tabs
      .sendMessage(tabId, { type: 'APPLY', ...(r as object) }, { frameId })
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
  jobs.get(id)?.controller.abort();
  jobs.delete(id);
  epochs.delete(id);
  void chrome.storage.session.remove(['job:' + id, 'render:' + id, 'follow:' + id]);
});
