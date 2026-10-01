import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { zipSync, strToU8 } from 'fflate';
import { AnissiaProvider } from '../src/providers/anissia/AnissiaProvider';
import { matchAnissiaTitle } from '../src/providers/anissia/titleMatching';
import { database } from '../src/storage/database';
import { SubtitleLinkResolverChain } from '../src/subtitle/links/SubtitleLinkResolverChain';
import { SubtitlePipeline } from '../src/subtitle/SubtitlePipeline';
import { defaultSettings } from '../src/storage/settings';
import { SelectionRequired } from '../src/subtitle/SubtitleSelection';
import { AppError } from '../src/utils/errors';
import { extractSubtitle } from '../src/subtitle/archive';
const c = {
  site: 'miruro' as const,
  title: 'You and I Are Polar Opposites Season 2',
  nativeTitle: '正反対な君と僕 第2期',
  season: 2,
  episode: 12,
  episodeOffset: 12,
  pageUrl: 'https://www.miruro.to/',
};
const anime = {
  animeNo: 3495,
  subject: '정반대의 너와 나 2기',
  originalSubject: c.nativeTitle,
  startDate: '2026-07-05',
  endDate: '2026-10-04',
};
const caption = {
  episode: '12',
  website: 'https://blog.example/post',
  name: 'Author',
  updDt: '2026-09-28',
};
const json = (data: unknown) => new Response(JSON.stringify({ code: 'ok', data }));
const srt = '1\n00:00:01,000 --> 00:00:03,000\n한국어 실제 회차';
beforeEach(async () => {
  await database.clear();
});
afterEach(() => vi.unstubAllGlobals());
describe('Anissia Korean acquisition regressions', () => {
  it('does not reuse a cached cumulative direct file after its offset can no longer be verified', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => (url.includes('/schedule/') ? json([anime]) : json([caption]))),
    );
    const load = vi.fn(async (url: string) => ({
      url,
      headers: new Headers({ 'content-disposition': 'attachment; filename="Seihantai - 24.srt"' }),
      bytes: strToU8(srt),
    }));
    const provider = new AnissiaProvider(undefined, new SubtitleLinkResolverChain(undefined, load));
    const pipe = () =>
      new SubtitlePipeline([provider], defaultSettings, vi.fn(), new AbortController().signal);
    expect((await pipe().resolve(c, 'ko')).cues).toHaveLength(1);
    await expect(pipe().resolve({ ...c, episodeOffset: undefined }, 'ko')).rejects.toBeInstanceOf(
      SelectionRequired,
    );
    expect(load).toHaveBeenCalledTimes(2);
  });
  it('rejects a cumulative filename without verified preceding episodes and refuses ambiguous relative/cumulative archives', () => {
    const one = zipSync({ 'Seihantai - 24.srt': strToU8(srt) });
    expect(() => extractSubtitle(one.buffer as ArrayBuffer, 12, undefined, 2)).toThrow('회차');
    const both = zipSync({
      'Seihantai - 12.srt': strToU8(srt),
      'Seihantai - 24.srt': strToU8(srt),
    });
    expect(() =>
      extractSubtitle(both.buffer as ArrayBuffer, 12, undefined, 2, ['12', '24']),
    ).toThrow('회차를 확정');
  });
  it('searches archived catalogue pages and native index tokens when absent from the schedule', async () => {
    const old = {
      ...anime,
      animeNo: 2517,
      subject: '장송의 프리렌',
      originalSubject: '葬送のフリーレン',
      startDate: '2023-09-29',
      endDate: '2024-03-22',
    };
    const fetch = vi.fn(async (url: string) => {
      if (url.includes('/schedule/')) return json([]);
      if (url.includes('/list/')) {
        const u = new URL(url);
        return json({
          content:
            u.searchParams.get('q') === 'フリーレン' && u.pathname.endsWith('/1') ? [old] : [],
          totalPages: u.searchParams.get('q') === 'フリーレン' ? 2 : 1,
        });
      }
      return json([{ ...caption, episode: '28' }]);
    });
    vi.stubGlobal('fetch', fetch);
    const result = await new AnissiaProvider().search(
      {
        ...c,
        title: 'Frieren',
        nativeTitle: old.originalSubject,
        season: 1,
        year: 2023,
        episode: 7,
        episodeOffset: undefined,
      },
      'ko',
    );
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      animeNo: 2517,
      episode: '7',
      listedEpisode: '28',
      requireEpisodeMatch: true,
    });
    expect(fetch.mock.calls.some(([u]) => u.includes('/list/1?'))).toBe(true);
  });
  it('uses the Korean record season when the original title has no season suffix', () => {
    expect(
      matchAnissiaTitle(
        { ...c, nativeTitle: '正反対な君と僕' },
        { ...anime, originalSubject: '正反対な君と僕' },
      ),
    ).toBe('正反対な君と僕');
    expect(
      matchAnissiaTitle(
        { ...c, season: 1, nativeTitle: '正反対な君と僕' },
        { ...anime, originalSubject: '正反対な君と僕' },
      ),
    ).toBeUndefined();
  });
  it.each(['12', '24'])(
    'applies season two episode twelve from a verified cumulative episode 24 ZIP (API lists %s)',
    async (listed) => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async (url: string) =>
          url.includes('/schedule/') ? json([anime]) : json([{ ...caption, episode: listed }]),
        ),
      );
      const chain = new SubtitleLinkResolverChain(undefined, async (url) => ({
        url,
        headers: new Headers({ 'content-type': 'application/zip' }),
        bytes: zipSync({ 'Seihantai - 24.srt': strToU8(srt) }),
      }));
      const result = await new SubtitlePipeline(
        [new AnissiaProvider(undefined, chain)],
        defaultSettings,
        vi.fn(),
        new AbortController().signal,
      ).resolve(c, 'ko');
      expect(result.language).toBe('ko');
      expect(result.cues[0].text).toBe('한국어 실제 회차');
    },
  );
  it.each(['Show - 8.srt', 'subtitle.srt'])(
    'does not apply a latest-author file without proof of the requested historical episode (%s)',
    async (filename) => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async (url: string) =>
          url.includes('/schedule/') ? json([anime]) : json([{ ...caption, episode: '12' }]),
        ),
      );
      const chain = new SubtitleLinkResolverChain(undefined, async (url) => ({
        url,
        headers: new Headers(),
        bytes: zipSync({ [filename]: strToU8(srt) }),
      }));
      await expect(
        new SubtitlePipeline(
          [new AnissiaProvider(undefined, chain)],
          defaultSettings,
          vi.fn(),
          new AbortController().signal,
        ).resolve({ ...c, episode: 7, episodeOffset: undefined }, 'ko'),
      ).rejects.toBeInstanceOf(SelectionRequired);
    },
  );
  it('extracts a historical episode from a complete archive instead of filtering the author out', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        url.includes('/schedule/') ? json([anime]) : json([{ ...caption, episode: '12' }]),
      ),
    );
    const chain = new SubtitleLinkResolverChain(undefined, async (url) => ({
      url,
      headers: new Headers(),
      bytes: zipSync({
        'Show - 7.srt': strToU8(srt),
        'Show - 12.srt': strToU8(srt.replace('실제', '다른')),
      }),
    }));
    const result = await new SubtitlePipeline(
      [new AnissiaProvider(undefined, chain)],
      defaultSettings,
      vi.fn(),
      new AbortController().signal,
    ).resolve({ ...c, episode: 7, episodeOffset: undefined }, 'ko');
    expect(result.cues[0].text).toBe('한국어 실제 회차');
  });
  it('preserves the search connection error in manual mode and continues AUTO fallback', async () => {
    const p = {
      id: 'anissia',
      search: vi.fn(async () => {
        throw new AppError('ANISSIA_API', 'Anissia 연결 실패');
      }),
      download: vi.fn(),
    };
    const pipe = () =>
      new SubtitlePipeline(
        [p],
        defaultSettings,
        vi.fn(),
        new AbortController().signal,
        async () => [
          {
            kind: 'texttrack',
            language: 'en',
            cues: [{ id: 1, startTime: 1, endTime: 3, text: 'Hello' }],
          },
        ],
      );
    await expect(pipe().resolve(c, 'ko')).rejects.toThrow('Anissia 연결 실패');
    expect((await pipe().resolve(c, 'auto')).source).toBe('embedded-en');
  });
});
