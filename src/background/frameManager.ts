import { registerPlayerScripts } from './playerScripts';
import type { SubtitleSource } from '../sites/types';
import type { SubtitleCue } from '../subtitle/SubtitleCue';
import type { DisplaySettings } from '../subtitle/SubtitleRenderer';
import { AppError } from '../utils/errors';
export interface FrameInfo {
  frameId: number;
  url: string;
  parentFrameId: number;
  hasVideo?: boolean;
  area?: number;
  documentId?: string;
}
const available = new Map<number, Map<number, FrameInfo>>();
export function supportedSite(url?: string) {
  try {
    const h = new URL(url ?? '').hostname;
    return /(^|\.)miruro\.to$/.test(h) || h === 'reanime.to';
  } catch {
    return false;
  }
}
export async function supportedTab(tabId: number) {
  return supportedSite((await chrome.tabs.get(tabId)).url);
}
export async function recordFrame(
  sender: chrome.runtime.MessageSender,
  hasVideo: boolean,
  area: number,
) {
  const tabId = sender.tab?.id;
  if (tabId === undefined || sender.frameId === undefined || !(await supportedTab(tabId)))
    return false;
  let frames = available.get(tabId);
  if (!frames) available.set(tabId, (frames = new Map()));
  const previous = frames.get(sender.frameId);
  const changed = hasVideo && (!previous?.hasVideo || previous.documentId !== sender.documentId);
  frames.set(sender.frameId, {
    frameId: sender.frameId,
    parentFrameId: -1,
    url: sender.url ?? '',
    hasVideo,
    area: Math.min(area, 100000000),
    documentId: sender.documentId,
  });
  return changed;
}
export async function frameInventory(tabId: number): Promise<FrameInfo[]> {
  if (!(await supportedTab(tabId)))
    throw new AppError('SITE', '지원 사이트 영상 페이지에서 사용하세요.');
  return (await chrome.webNavigation.getAllFrames({ tabId })) ?? [];
}
export async function videoFrames(tabId: number) {
  const inventory = await frameInventory(tabId);
  const active = new Set(inventory.map((f) => f.frameId));
  const map = available.get(tabId);
  if (map) for (const id of map.keys()) if (!active.has(id)) map.delete(id);
  const found = [...(map?.values() ?? [])]
    .filter((f) => f.hasVideo)
    .sort((a, b) => (b.area ?? 0) - (a.area ?? 0));
  if (found.length) return found;
  const topReply = await chrome.tabs
    .sendMessage(tabId, { type: 'FRAME_PROBE' }, { frameId: 0 })
    .catch(() => null);
  return topReply?.video
    ? [
        {
          frameId: 0,
          parentFrameId: -1,
          url: (await chrome.tabs.get(tabId)).url ?? '',
          hasVideo: true,
        },
      ]
    : [];
}
export async function collectSubtitles(tabId: number): Promise<SubtitleSource[]> {
  const videos = await videoFrames(tabId);
  const frames = [...new Set([...videos.map((f) => f.frameId), 0])];
  const results = await Promise.allSettled(
    frames.map((frameId) => chrome.tabs.sendMessage(tabId, { type: 'SOURCES' }, { frameId })),
  );
  const sources: SubtitleSource[] = [];
  for (const r of results)
    if (r.status === 'fulfilled' && Array.isArray(r.value.sources))
      sources.push(...r.value.sources);
  return sources;
}
export async function applyCues(
  tabId: number,
  cues: SubtitleCue[],
  display: DisplaySettings,
  offset: number,
  epoch: number,
) {
  const frames = await videoFrames(tabId);
  if (!frames.length)
    throw new AppError(
      'VIDEO',
      '영상 요소를 찾지 못했습니다. 재생을 시작하고 플레이어 iframe 접근을 허용하세요.',
    );
  const results = await Promise.allSettled(
    frames.map((f) =>
      chrome.tabs.sendMessage(
        tabId,
        { type: 'APPLY', cues, display, offset, epoch },
        { frameId: f.frameId, ...(f.documentId ? { documentId: f.documentId } : {}) },
      ),
    ),
  );
  if (!results.some((r) => r.status === 'fulfilled' && r.value?.ok))
    throw new AppError('VIDEO', '영상 프레임에 자막을 전달하지 못했습니다.');
}
export async function sendVideoMessage(tabId: number, message: Record<string, unknown>) {
  const frames = await videoFrames(tabId).catch(() => []);
  return Promise.allSettled(
    frames.map((f) =>
      chrome.tabs.sendMessage(tabId, message, {
        frameId: f.frameId,
        ...(f.documentId ? { documentId: f.documentId } : {}),
      }),
    ),
  );
}
export async function clearFrames(tabId: number, epoch: number) {
  try {
    const frames = await frameInventory(tabId);
    await Promise.allSettled(
      frames.map((f) =>
        chrome.tabs.sendMessage(tabId, { type: 'CLEAR', epoch }, { frameId: f.frameId }),
      ),
    );
  } catch {}
}
export async function injectFrame(tabId: number, frameId: number) {
  if (!(await supportedTab(tabId))) return;
  try {
    await chrome.scripting.executeScript({
      target: { tabId, frameIds: [frameId] },
      world: 'MAIN',
      files: ['pageBridge.js'],
    });
    await chrome.scripting.executeScript({
      target: { tabId, frameIds: [frameId] },
      world: 'ISOLATED',
      files: ['contentScript.js'],
    });
  } catch {
    /* Missing host permissions are shown by frame inventory in Popup. */
  }
}
export async function injectFrames(tabId: number) {
  const frames = await frameInventory(tabId);
  await registerPlayerScripts(frames);
  await Promise.allSettled(
    frames.filter((f) => f.frameId !== 0).map((f) => injectFrame(tabId, f.frameId)),
  );
}
chrome.webNavigation.onCommitted.addListener((d) => {
  if (d.frameId !== 0) void injectFrame(d.tabId, d.frameId);
});
chrome.tabs.onRemoved.addListener((id) => available.delete(id));
