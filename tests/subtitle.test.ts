import { describe, it, expect } from 'vitest';
import { parseSubtitle } from '../src/subtitle/SubtitleParser';
import { loadHLSSubtitles, subtitleRenditions } from '../src/subtitle/HLSSubtitles';
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

  it('ASS strips vector drawing commands and ignores drawing-only lines', () => {
    const assContent = [
      '[Events]',
      'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
      'Dialogue: 0,0:00:01.00,0:00:03.00,Default,,0,0,0,,{\\p1}m 0 0 l 100 0 100 100 0 100{\\p0}',
      'Dialogue: 0,0:00:03.50,0:00:05.00,Default,,0,0,0,,{\\pos(100,200)\\p1}m 0 0 l 50 50{\\p0}실제 대사 텍스트',
      'Dialogue: 0,0:00:06.00,0:00:08.00,Default,,0,0,0,,대사 앞부분{\\p2}m 10 20 l 30 40{\\p0}대사 뒷부분',
    ].join('\n');

    const cues = parseSubtitle(assContent, 'ass');
    expect(cues).toHaveLength(2);
    expect(cues[0]).toMatchObject({
      startTime: 3.5,
      endTime: 5.0,
      text: '실제 대사 텍스트',
    });
    expect(cues[1]).toMatchObject({
      startTime: 6.0,
      endTime: 8.0,
      text: '대사 앞부분대사 뒷부분',
    });
  });

  it('SMI caps subtitle duration at 7 seconds when next sync is far away', () => {
    const smiContent = [
      '<SAMI>',
      '<BODY>',
      '<SYNC Start=10000><P Class=KRCC>첫 번째 대사',
      '<SYNC Start=70000><P Class=KRCC>두 번째 대사 (60초 뒤)',
      '<SYNC Start=73000><P Class=KRCC>&nbsp;',
      '</BODY>',
      '</SAMI>',
    ].join('\n');

    const cues = parseSubtitle(smiContent, 'smi');
    expect(cues).toHaveLength(2);
    expect(cues[0]).toMatchObject({
      startTime: 10,
      endTime: 17,
      text: '첫 번째 대사',
    });
    expect(cues[1]).toMatchObject({
      startTime: 70,
      endTime: 73,
      text: '두 번째 대사 (60초 뒤)',
    });
  });

  it('loads Japanese HLS subtitles when requested', async () => {
    const masterManifest = [
      '#EXTM3U',
      '#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="subs",NAME="English",DEFAULT=YES,AUTOSELECT=YES,LANGUAGE="en",URI="en.m3u8"',
      '#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="subs",NAME="Japanese",DEFAULT=NO,AUTOSELECT=NO,LANGUAGE="ja",URI="ja.m3u8"',
      '#EXT-X-STREAM-INF:BANDWIDTH=1000000,SUBTITLES="subs"',
      'video.m3u8',
    ].join('\n');

    const jaSubManifest = [
      '#EXTM3U',
      '#EXT-X-TARGETDURATION:10',
      '#EXTINF:10.0,',
      'ja_seg1.vtt',
    ].join('\n');

    const vttContent = [
      'WEBVTT',
      '',
      '00:00:01.000 --> 00:00:03.000',
      '日本語の字幕です',
    ].join('\n');

    const mockLoad = async (url: string) => {
      if (url === 'https://example.com/master.m3u8') return masterManifest;
      if (url === 'https://example.com/ja.m3u8') return jaSubManifest;
      if (url === 'https://example.com/ja_seg1.vtt') return vttContent;
      throw new Error(`Unexpected url: ${url}`);
    };

    const cues = await loadHLSSubtitles('https://example.com/master.m3u8', mockLoad, undefined, 'ja');
    expect(cues).toHaveLength(1);
    expect(cues[0]).toMatchObject({
      startTime: 1,
      endTime: 3,
      text: '日本語の字幕です',
    });
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
