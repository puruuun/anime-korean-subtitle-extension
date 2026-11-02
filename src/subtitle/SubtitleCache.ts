import { database } from '../storage/database';
interface DownloadEntry {
  data: ArrayBuffer;
  at: number;
}
export class SubtitleCache {
  async get(key: string) {
    const cached = await database.get<DownloadEntry>('download:' + key);
    if (!cached) return undefined;
    if (Date.now() - cached.at >= 86400000) {
      await database.delete('download:' + key).catch(() => {});
      return undefined;
    }
    return cached.data;
  }
  put(key: string, data: ArrayBuffer) {
    return database.put('download:' + key, { data, at: Date.now() });
  }
}
export async function subtitleHash(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((x) => x.toString(16).padStart(2, '0')).join('');
}
