import { describe, it, expect } from 'vitest';
import { parseSubtitle } from '../src/subtitle/SubtitleParser';
import { scoreResult } from '../src/subtitle/SubtitleSearch';
import { extractSubtitle } from '../src/subtitle/archive';
import { decodeSubtitle } from '../src/utils/encoding';
import { zipSync, strToU8 } from 'fflate';
const c = {
  site: 'miruro' as const,
  title: 'Frieren',
  episode: 7,
  season: 1,
  pageUrl: 'https://www.miruro.to/watch/x?ep=7',
  imdbId: 'tt123',
};
describe('subtitle formats and matching', () => {
  it('SRT keeps time and strips markup safely', () => {
    expect(parseSubtitle('1\n00:01:02,123 --> 00:01:04,500\n<b>안녕</b>\n둘째 줄')).toEqual([
      { id: 1, startTime: 62.123, endTime: 64.5, text: '안녕\n둘째 줄' },
    ]);
  });
  it('VTT handles identifiers, cue settings and NOTE', () => {
    expect(
      parseSubtitle(
        'WEBVTT\n\nNOTE hi\nignored\n\ncue-a\n01:02.100 --> 01:05.200 align:start\nHello',
      ),
    ).toHaveLength(1);
  });
  it('ASS handles commas and line breaks', () => {
    expect(
      parseSubtitle(
        '[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\nDialogue: 0,0:00:01.10,0:00:03.20,Default,,0,0,0,,{\\i1}안녕, 친구\\N다음 줄',
      )[0],
    ).toMatchObject({ startTime: 1.1, endTime: 3.2, text: '안녕, 친구\n다음 줄' });
  });
  it('rejects invalid data', () => {
    expect(() => parseSubtitle('<html>error</html>')).toThrow();
    expect(() => decodeSubtitle(new Uint8Array([0xff, 0xfe, 0, 0]))).toThrow();
  });
  it('wrong and unknown episode never auto-apply', () => {
    const r = {
      id: '1',
      providerId: 'mock',
      title: 'Frieren',
      release: 'WEB',
      language: 'ko' as const,
      imdbId: 'tt123',
    };
    expect(scoreResult(c, { ...r, episode: 8 }, 'ko').autoEligible).toBe(false);
    expect(scoreResult(c, r, 'ko').autoEligible).toBe(false);
    expect(scoreResult(c, { ...r, episode: 7 }, 'ko').autoEligible).toBe(true);
  });
  it('selects current episode inside ZIP and rejects ambiguity', () => {
    const bytes = zipSync({ 'Show.S01E07.srt': strToU8('7'), 'Show.S01E08.srt': strToU8('8') });
    expect(extractSubtitle(bytes.buffer as ArrayBuffer, 7).name).toBe('Show.S01E07.srt');
    expect(() => extractSubtitle(bytes.buffer as ArrayBuffer, 9)).toThrow();
  });
});
