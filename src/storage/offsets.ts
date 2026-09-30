import { contextKey, type AnimeContext } from '../anime/AnimeContext';
export async function getOffset(c: AnimeContext) {
  const key = 'offset:' + contextKey(c);
  const r = await chrome.storage.local.get(key);
  return Number(r[key]) || 0;
}
export async function setOffset(c: AnimeContext, value: number) {
  const v = Math.round(Math.max(-10, Math.min(10, value)) * 10) / 10;
  await chrome.storage.local.set({ ['offset:' + contextKey(c)]: v });
  return v;
}
