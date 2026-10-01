import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { SubtitlePipeline } from '../src/subtitle/SubtitlePipeline';
import { SubtitleCore, SelectionRequired } from '../src/subtitle/SubtitleCore';
import { JapaneseSubtitleSearchManager } from '../src/providers/japanese/JapaneseSubtitleSearchManager';
import { JimakuProvider } from '../src/providers/jimaku/JimakuProvider';
import { defaultSettings } from '../src/storage/settings';
import { database } from '../src/storage/database';
import type { SubtitleProvider, SubtitleSearchResult } from '../src/providers/SubtitleProvider';
import { SubtitleLinkUnavailable } from '../src/subtitle/links/SubtitleLinkResolver';
import { withDeadline } from '../src/utils/deadline';
const c = {
  site: 'miruro' as const,
  title: 'Test Show',
  episode: 7,
  season: 1,
  pageUrl: 'https://www.miruro.to/watch/test?ep=7',
};
const file = (text = '原文') =>
  new TextEncoder().encode('1\n00:00:01,000 --> 00:00:03,000\n' + text).buffer;
const candidate = (
  id: string,
  extra: Partial<SubtitleSearchResult> = {},
): SubtitleSearchResult => ({
  id: id + ':7',
  providerId: id,
  title: c.title,
  release: id,
  episode: 7,
  language: id === 'anissia' ? 'ko' : 'ja',
  ...extra,
});
const provider = (
  id: string,
  results: SubtitleSearchResult[] = [candidate(id)],
): SubtitleProvider => ({
  id,
  search: vi.fn(async () => results),
  download: vi.fn(async () => file()),
});
const english = vi.fn(async () => [
  {
    kind: 'texttrack' as const,
    language: 'en',
    cues: [{ id: 1, startTime: 1, endTime: 3, text: 'Hello' }],
  },
]);
const settings = () => structuredClone(defaultSettings);
function pipeline(
  providers: SubtitleProvider[],
  s = settings(),
  signal = new AbortController().signal,
) {
  return new SubtitlePipeline(providers, s, vi.fn(), signal, english);
}
beforeEach(async () => {
  await database.clear();
  english.mockClear();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
describe('AUTO source acquisition and independent manual modes', () => {
  it('A: Anissia applies Korean directly and never searches Japanese or calls translation', async () => {
    const providers = [provider('anissia'), provider('jimaku'), provider('kitsunekko')];
    class Core extends SubtitleCore {
      protected override translate = vi.fn();
    }
    const core = new Core(providers, settings(), vi.fn(), new AbortController().signal, english);
    expect(await core.run(c, 'auto')).toHaveLength(1);
    expect(core['translate']).not.toHaveBeenCalled();
    expect(providers[1].search).not.toHaveBeenCalled();
    expect(providers[2].search).not.toHaveBeenCalled();
    expect(english).not.toHaveBeenCalled();
  });
  it('B: an unusable Anissia website falls through to Jimaku and JA uses existing translation hook', async () => {
    const ko = provider('anissia');
    ko.download = vi.fn(async () => {
      throw new SubtitleLinkUnavailable({
        kind: 'page',
        pageUrl: 'https://blog.example',
        message: 'unresolved',
      });
    });
    const jimaku = provider('jimaku'),
      mirror = provider('kitsunekko');
    const translated = vi.fn(
      async (cues: import('../src/subtitle/SubtitleCue').SubtitleCue[]) => cues,
    );
    class Core extends SubtitleCore {
      protected override translate = translated;
    }
    const core = new Core(
      [ko, jimaku, mirror],
      settings(),
      vi.fn(),
      new AbortController().signal,
      english,
    );
    await core.run(c, 'auto');
    expect(translated).toHaveBeenCalledWith(expect.any(Array), c, 'ja');
    expect(mirror.search).not.toHaveBeenCalled();
    expect(english).not.toHaveBeenCalled();
  });
  it('C: no Jimaku key skips all Jimaku HTTP requests and uses Kitsunekko', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const mirror = provider('kitsunekko');
    expect(
      (await pipeline([provider('anissia', []), new JimakuProvider(''), mirror]).resolve(c, 'auto'))
        .source,
    ).toBe('kitsunekko');
    expect(fetch).not.toHaveBeenCalled();
    expect(mirror.download).toHaveBeenCalledOnce();
  });
  it.each([401, 403, 429, 500])(
    'D: Jimaku HTTP %s falls through to Kitsunekko without an error popup',
    async (code) => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => new Response('{}', { status: code })),
      );
      expect(
        (
          await pipeline([
            provider('anissia', []),
            new JimakuProvider('fake'),
            provider('kitsunekko'),
          ]).resolve(c, 'auto')
        ).source,
      ).toBe('kitsunekko');
    },
  );
  it('E: wrong episode, invalid files and empty searches fall through to embedded English', async () => {
    const jimaku = provider('jimaku', [candidate('jimaku', { episode: 8 })]);
    const mirror = provider('kitsunekko');
    mirror.download = vi.fn(
      async () => new TextEncoder().encode('<html>Not a subtitle</html>').buffer,
    );
    expect(
      (await pipeline([provider('anissia', []), jimaku, mirror]).resolve(c, 'auto')).source,
    ).toBe('embedded-en');
    expect(jimaku.download).not.toHaveBeenCalled();
    expect(english).toHaveBeenCalledOnce();
  });
  it('candidate found is not success: tries the next author/file before provider fallback', async () => {
    const ko = provider('anissia', [
      candidate('anissia', { id: 'author1', updatedAt: '2026-10-01' }),
      candidate('anissia', { id: 'author2' }),
    ]);
    ko.download = vi
      .fn()
      .mockRejectedValueOnce(Error('broken'))
      .mockResolvedValueOnce(file('한국어'));
    const jimaku = provider('jimaku');
    expect((await pipeline([ko, jimaku]).resolve(c, 'auto')).source).toBe('anissia');
    expect(ko.download).toHaveBeenCalledTimes(2);
    expect(jimaku.search).not.toHaveBeenCalled();
    const jp = provider('jimaku', [
      candidate('jimaku', { id: 'bad' }),
      candidate('jimaku', { id: 'good' }),
    ]);
    jp.download = vi.fn().mockRejectedValueOnce(Error('bad')).mockResolvedValueOnce(file());
    expect((await pipeline([jp, provider('kitsunekko')]).resolve(c, 'ja')).source).toBe('jimaku');
    expect(jp.download).toHaveBeenCalledTimes(2);
  });
  it('F: Manual Korean uses only Anissia and preserves page/permission details', async () => {
    const ko = provider('anissia');
    ko.download = vi.fn(async () => {
      throw new SubtitleLinkUnavailable({
        kind: 'page',
        pageUrl: 'https://blog.example',
        message: 'grant',
        requiredOrigins: ['https://blog.example/*'],
      });
    });
    const jp = provider('jimaku');
    await expect(pipeline([ko, jp]).resolve(c, 'ko')).rejects.toBeInstanceOf(SelectionRequired);
    expect(jp.search).not.toHaveBeenCalled();
    expect(english).not.toHaveBeenCalled();
  });
  it('G: Manual Japanese uses Jimaku then Kitsunekko and never Korean or English', async () => {
    const ko = provider('anissia');
    expect(
      (await pipeline([ko, provider('jimaku', []), provider('kitsunekko')]).resolve(c, 'ja'))
        .source,
    ).toBe('kitsunekko');
    expect(ko.search).not.toHaveBeenCalled();
    expect(english).not.toHaveBeenCalled();
    await expect(
      pipeline([ko, provider('jimaku', []), provider('kitsunekko', [])]).resolve(c, 'ja'),
    ).rejects.toThrow('일본어');
    expect(english).not.toHaveBeenCalled();
  });
  it('H: Manual English never searches external providers', async () => {
    const providers = [provider('anissia'), provider('jimaku'), provider('kitsunekko')];
    expect((await pipeline(providers).resolve(c, 'en')).source).toBe('embedded-en');
    for (const p of providers) expect(p.search).not.toHaveBeenCalled();
  });
  it('AUTO skips disabled stages while manual still executes its selected source', async () => {
    const s = settings();
    s.autoSources.anissia = false;
    s.autoSources.japaneseTranslation = false;
    const ko = provider('anissia'),
      jp = provider('jimaku');
    expect((await pipeline([ko, jp], s).resolve(c, 'auto')).source).toBe('embedded-en');
    expect(ko.search).not.toHaveBeenCalled();
    expect(jp.search).not.toHaveBeenCalled();
    expect((await pipeline([ko, jp], s).resolve(c, 'ko')).source).toBe('anissia');
    s.autoSources.embeddedEnglish = false;
    await expect(pipeline([], s).resolve(c, 'auto')).rejects.toThrow(
      '사용 가능한 한국어/일본어/영어 자막을 찾지 못했습니다.',
    );
  });
  it('I: cancellation aborts an in-flight download and never starts the next provider', async () => {
    const controller = new AbortController(),
      jp = provider('jimaku');
    const ko = provider('anissia');
    ko.download = vi.fn(async (_candidate, signal) => {
      controller.abort();
      signal!.throwIfAborted();
      return file();
    });
    await expect(
      pipeline([ko, jp], settings(), controller.signal).resolve(c, 'auto'),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(jp.search).not.toHaveBeenCalled();
    expect(english).not.toHaveBeenCalled();
  });
  it('bounds slow provider attempts and cancels their requests before fallback', async () => {
    let attempt: AbortSignal | undefined;
    const jp = provider('jimaku');
    jp.search = vi.fn(async (_c, _l, signal) => {
      attempt = signal;
      return new Promise<SubtitleSearchResult[]>(() => {});
    });
    const result = await new JapaneseSubtitleSearchManager(
      [jp, provider('kitsunekko')],
      10,
    ).resolve(c, new AbortController().signal);
    expect(result?.candidate.providerId).toBe('kitsunekko');
    expect(attempt?.aborted).toBe(true);
  });
  it('a deadline includes slow candidate resolution and respects a pre-aborted parent', async () => {
    let child: AbortSignal | undefined;
    await expect(
      withDeadline(new AbortController().signal, 10, async (signal) => {
        child = signal;
        return new Promise(() => {});
      }),
    ).rejects.toThrow('시간');
    expect(child?.aborted).toBe(true);
    const parent = new AbortController();
    parent.abort();
    const run = vi.fn();
    await expect(withDeadline(parent.signal, 10, run)).rejects.toMatchObject({
      name: 'AbortError',
    });
    expect(run).not.toHaveBeenCalled();
  });
});
