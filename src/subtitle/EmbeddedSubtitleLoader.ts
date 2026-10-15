import type { SubtitleSource } from '../sites/types';
import type { SubtitleCue } from './SubtitleCue';
import { request, publicSubtitleURL } from '../background/network';
import { decodeSubtitle } from '../utils/encoding';
import { parseSubtitle } from './SubtitleParser';
import { loadHLSSubtitles } from './HLSSubtitles';
import { AppError } from '../utils/errors';
export async function loadEmbeddedSource(
  source: SubtitleSource,
  signal?: AbortSignal,
  language: 'ja' | 'en' = 'en',
): Promise<SubtitleCue[]> {
  if (source.cues?.length) {
    if (
      source.cues.length > 30000 ||
      source.cues.some(
        (c) =>
          !Number.isFinite(c.startTime) ||
          !Number.isFinite(c.endTime) ||
          c.endTime <= c.startTime ||
          typeof c.text !== 'string' ||
          c.text.includes('\uFFFD'),
      )
    )
      throw new AppError('FORMAT', '내장 영문 자막 형식이 잘못되었습니다.');
    return source.cues;
  }
  if (!source.url) throw new AppError('EN_NOT_FOUND', '영문 자막을 찾지 못했습니다.');
  const load = async (url: string) => {
    if (/\.(?:mp4|m4s|ts|aac|mp3|webm)(?:[?#]|$)/i.test(url))
      throw new AppError('FORMAT', '영상·오디오 파일은 다운로드하지 않습니다.');
    return decodeSubtitle(
      new Uint8Array(await request(publicSubtitleURL(url), {}, 25000, signal, true)),
      language,
    );
  };
  return source.kind === 'hls'
    ? loadHLSSubtitles(source.url, load, signal)
    : parseSubtitle(await load(source.url), source.format);
}
