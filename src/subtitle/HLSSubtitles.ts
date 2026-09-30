import type { SubtitleCue } from './SubtitleCue';
import { parseSubtitle, timestamp } from './SubtitleParser';
import { AppError } from '../utils/errors';
export function hlsAttributes(line: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of line.matchAll(/([A-Z-]+)=("[^"]*"|[^,]+)/g))
    out[m[1]] = m[2].replace(/^"|"$/g, '');
  return out;
}
export function englishRenditions(manifest: string, base: string) {
  return manifest
    .split(/\r?\n/)
    .filter((l) => l.startsWith('#EXT-X-MEDIA:'))
    .map(hlsAttributes)
    .filter(
      (a) =>
        a.TYPE === 'SUBTITLES' &&
        a.URI &&
        /^(en(?:-.*)?|eng|english)/i.test(a.LANGUAGE ?? a.NAME ?? ''),
    )
    .map((a) => new URL(a.URI, base).href);
}
export async function loadHLSSubtitles(
  url: string,
  load: (url: string) => Promise<string>,
  signal?: AbortSignal,
): Promise<SubtitleCue[]> {
  const text = await load(url);
  if (!text.startsWith('#EXTM3U'))
    throw new AppError('HLS', '자막 HLS manifest를 읽을 수 없습니다.');
  const variants = englishRenditions(text, url);
  if (variants.length) return loadHLSSubtitles(variants[0], load, signal);
  // Only a playlist already identified as TYPE=SUBTITLES may enter this path.
  const lines = text.split(/\r?\n/);
  const segments = lines
    .filter((l) => l.trim() && !l.startsWith('#'))
    .map((l) => new URL(l.trim(), url).href);
  if (!segments.length || segments.length > 500)
    throw new AppError('HLS', 'HLS 자막 세그먼트 수가 지원 범위를 벗어났습니다.');
  const cues: SubtitleCue[] = [];
  let start = 0,
    firstMpeg: number | undefined;
  const seen = new Set<string>();
  for (const segment of segments) {
    signal?.throwIfAborted();
    if (/\.(?:ts|mp4|m4s|aac|mp3|webm)(?:[?#]|$)/i.test(segment))
      throw new AppError('HLS', '영상·오디오 세그먼트는 다운로드하지 않습니다.');
    const raw = await load(segment);
    if (!/^\uFEFF?WEBVTT/.test(raw))
      throw new AppError(
        'HLS',
        'HLS 리소스가 WebVTT 자막이 아닙니다. 영상·오디오 세그먼트는 처리하지 않습니다.',
      );
    const map =
      raw.match(/X-TIMESTAMP-MAP\s*=\s*LOCAL:([^,\n]+),MPEGTS:(\d+)/i) ??
      raw.match(/X-TIMESTAMP-MAP\s*=\s*MPEGTS:(\d+),LOCAL:([^,\n]+)/i);
    let shift = 0;
    if (map) {
      const local =
        raw.includes('X-TIMESTAMP-MAP=LOCAL') || /LOCAL:[^,]+,MPEGTS:/.test(map[0])
          ? timestamp(map[1])
          : timestamp(map[2]);
      const mpeg = /LOCAL:[^,]+,MPEGTS:/.test(map[0]) ? Number(map[2]) : Number(map[1]);
      firstMpeg ??= mpeg;
      let delta = mpeg - firstMpeg;
      if (delta < -(2 ** 32)) delta += 2 ** 33;
      shift = delta / 90000 - local;
    }
    let parsed: SubtitleCue[];
    try {
      parsed = parseSubtitle(raw);
    } catch (e) {
      if (!/-->/.test(raw)) continue;
      throw e;
    }
    for (const cue of parsed) {
      const c = { ...cue, startTime: cue.startTime + shift, endTime: cue.endTime + shift };
      const key = JSON.stringify([c.startTime, c.endTime, c.text]);
      if (c.endTime > 0 && !seen.has(key)) {
        seen.add(key);
        cues.push({ ...c, id: ++start, startTime: Math.max(0, c.startTime) });
      }
    }
  }
  if (!cues.length) throw new AppError('HLS', 'HLS 영문 자막 Cue를 찾지 못했습니다.');
  return cues.sort((a, b) => a.startTime - b.startTime);
}
