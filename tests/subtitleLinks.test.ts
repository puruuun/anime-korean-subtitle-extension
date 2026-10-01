import { describe, it, expect, vi, afterEach } from 'vitest';
import { DirectFileResolver } from '../src/subtitle/links/DirectFileResolver';
import { GenericHtmlResolver, htmlSubtitleLinks } from '../src/subtitle/links/GenericHtmlResolver';
import { SubtitleLinkResolverChain } from '../src/subtitle/links/SubtitleLinkResolverChain';
import {
  createResourceLoader,
  SubtitleHostPermission,
  type SubtitleResource,
} from '../src/subtitle/links/resourceLoader';
import { parseSubtitle } from '../src/subtitle/SubtitleParser';
import { extractSubtitle } from '../src/subtitle/archive';
import { strToU8, zipSync } from 'fflate';
const candidate = {
  id: 'anissia:1',
  providerId: 'anissia',
  title: 'Show',
  release: '',
  language: 'ko' as const,
  episode: '12.5',
  pageUrl: 'https://blog.example/post',
};
const resource = (url: string, body: string, headers = {}): SubtitleResource => ({
  url,
  bytes: new TextEncoder().encode(body),
  headers: new Headers(headers),
});
const srt = '1\n00:00:01,000 --> 00:00:03,000\n안녕하세요';
afterEach(() => vi.unstubAllGlobals());
describe('separate, extensible subtitle link resolvers', () => {
  it('recognizes direct extensions, MIME types, content disposition and ZIP magic', async () => {
    const resolver = new DirectFileResolver();
    for (const ext of ['smi', 'srt', 'ass', 'vtt', 'zip'])
      expect((await resolver.resolve(resource('https://cdn.example/file.' + ext, srt)))?.kind).toBe(
        'file',
      );
    expect(
      await resolver.resolve(
        resource('https://cdn.example/download', srt, {
          'Content-Disposition': "attachment; filename*=UTF-8''Show.E12.5.srt",
        }),
      ),
    ).toMatchObject({ name: 'Show.E12.5.srt' });
    expect(
      await resolver.resolve(
        resource('https://cdn.example/download', 'binary', { 'Content-Type': 'application/zip' }),
      ),
    ).toMatchObject({ name: 'subtitle.zip' });
    const zip = resource('https://cdn.example/download', '');
    zip.bytes = zipSync({ 'Show.E12.5.srt': strToU8(srt) });
    expect(await resolver.resolve(zip)).toMatchObject({ name: 'subtitle.zip' });
  });
  it('does not treat HTML disguised as .srt or application/octet-stream as a subtitle', async () => {
    expect(
      await new DirectFileResolver().resolve(
        resource('https://cdn.example/file.srt', '<html>Download now</html>', {
          'Content-Type': 'application/octet-stream',
        }),
      ),
    ).toBeUndefined();
    expect(
      await new DirectFileResolver().resolve(
        resource('https://cdn.example/download', '<html>Error</html>', {
          'Content-Type': 'text/html',
        }),
      ),
    ).toBeUndefined();
  });
  it('extracts static relative and entity-escaped links; ignores script/comment and nonpublic links', () => {
    expect(
      htmlSubtitleLinks(
        `<a href="../files/Show.E12.5.smi?x=1&amp;y=2">file</a>
      <a HREF='/download?id=1' download='Show.E12.5.srt'>file</a>
      <script>const x='<a href="/fake.srt">';</script>
      <!-- <a href="/fake2.srt"> -->
      <a href="http://127.0.0.1/private.srt">bad</a>
      <a href="javascript:alert(1)">bad</a>`,
        candidate.pageUrl,
      ),
    ).toEqual([
      'https://blog.example/files/Show.E12.5.smi?x=1&y=2',
      'https://blog.example/download?id=1',
    ]);
  });
  it('chooses only an unambiguous episode link and downloads it through DirectFileResolver', async () => {
    const load = vi.fn(async (url: string) => resource(url, srt));
    const page = resource(
      candidate.pageUrl,
      '<html><a href="/Show.E12.srt">12</a><a href="/Show.E12.5.srt">12.5</a></html>',
    );
    const resolved = await new GenericHtmlResolver().resolve(page, { candidate, load });
    expect(resolved).toMatchObject({ kind: 'file', url: 'https://blog.example/Show.E12.5.srt' });
    expect(load).toHaveBeenCalledOnce();
  });
  it('returns the original page when no file, ambiguous files, wrong episode or a linked HTML page is found', async () => {
    const load = vi.fn(async (url: string) =>
      resource(url, '<html>Login</html>', { 'Content-Type': 'text/html' }),
    );
    const resolver = new GenericHtmlResolver();
    for (const html of [
      '<html>No files</html>',
      '<a href="/A.srt">a</a><a href="/B.srt">b</a>',
      '<a href="/Show.E13.srt">13</a>',
      '<a href="/Show.E12.5.srt">12.5</a>',
    ]) {
      expect(
        await resolver.resolve(resource(candidate.pageUrl, html), { candidate, load }),
      ).toMatchObject({ kind: 'page', pageUrl: candidate.pageUrl });
    }
    expect(load).toHaveBeenCalledOnce();
  });
  it('can insert a future site resolver before the generic fallback', async () => {
    const resolve = vi.fn(async () => ({
      kind: 'page' as const,
      pageUrl: candidate.pageUrl,
      message: 'custom resolver',
    }));
    const chain = new SubtitleLinkResolverChain([{ id: 'future-site', resolve }], async (url) =>
      resource(url, '<html></html>'),
    );
    expect(await chain.resolve(candidate)).toMatchObject({ message: 'custom resolver' });
    expect(resolve).toHaveBeenCalledOnce();
  });
  it('rejects a mismatched episode advertised by a download header and accepts season-episode filenames', async () => {
    const wrong = new SubtitleLinkResolverChain(undefined, async (url) =>
      resource(url, srt, { 'Content-Disposition': 'attachment; filename="Show.S01E13.srt"' }),
    );
    expect(await wrong.resolve(candidate)).toMatchObject({
      kind: 'page',
      pageUrl: candidate.pageUrl,
    });
    const correct = new SubtitleLinkResolverChain(undefined, async (url) =>
      resource(url, srt, { 'Content-Disposition': 'attachment; filename="Show.S01E12.5.srt"' }),
    );
    expect(await correct.resolve(candidate)).toMatchObject({ kind: 'file' });
  });
});
describe('resource loading and permission handoff', () => {
  it('reports the exact missing host to UI without fetching it', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const loader = createResourceLoader(async () => false);
    await expect(loader(candidate.pageUrl)).rejects.toBeInstanceOf(SubtitleHostPermission);
    const result = await new SubtitleLinkResolverChain(undefined, loader).resolve(candidate);
    expect(result).toMatchObject({
      kind: 'page',
      pageUrl: candidate.pageUrl,
      requiredOrigins: ['https://blog.example/*'],
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('requires the file CDN separately and preserves the distribution page', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response('<a href="https://cdn.example/Show.E12.5.srt">file</a>', {
            headers: { 'Content-Type': 'text/html' },
          }),
      ),
    );
    const loader = createResourceLoader(async (origin) => origin === 'https://blog.example/*');
    expect(await new SubtitleLinkResolverChain(undefined, loader).resolve(candidate)).toMatchObject(
      { kind: 'page', pageUrl: candidate.pageUrl, requiredOrigins: ['https://cdn.example/*'] },
    );
  });
  it('omits cookies and validates every redirect before fetching another host', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(null, { status: 302, headers: { Location: 'http://127.0.0.1/private.srt' } }),
    );
    vi.stubGlobal('fetch', fetchMock);
    await expect(createResourceLoader(async () => true)(candidate.pageUrl)).rejects.toThrow(
      '허용되지',
    );
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0]).toEqual([
      candidate.pageUrl,
      expect.objectContaining({
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
        redirect: 'manual',
      }),
    ]);
  });
  it('limits file size and rejects video while cancelling response bodies', async () => {
    const cases: Record<string, string>[] = [
      { 'Content-Length': String(9 * 1024 * 1024) },
      { 'Content-Type': 'video/mp4' },
    ];
    for (const headers of cases) {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => new Response('data', { headers })),
      );
      await expect(createResourceLoader(async () => true)(candidate.pageUrl)).rejects.toThrow();
    }
  });
  it('cancels obsolete API requests instead of returning a manual page result', async () => {
    const controller = new AbortController();
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url, init) => {
        controller.abort();
        throw init.signal.reason;
      }),
    );
    await expect(
      new SubtitleLinkResolverChain(
        undefined,
        createResourceLoader(async () => true),
      ).resolve(candidate, controller.signal),
    ).rejects.toMatchObject({ name: 'AbortError' });
  });
});
describe('Korean SAMI files', () => {
  const smi =
    '<SAMI><HEAD><STYLE>.KRCC {lang:ko-KR}</STYLE></HEAD><BODY>\n<SYNC Start=1000><P Class=KRCC>안녕<br>친구<P Class=ENCC>Hello\n<SYNC Start="3000"><P Class=KRCC>&nbsp;\n<SYNC Start=4500><P Class=KRCC>다음\n<SYNC Start=6000><P Class=KRCC>&nbsp;</BODY></SAMI>';
  it('parses Korean paragraphs, line breaks and blank closing syncs with original times', () => {
    expect(parseSubtitle(smi)).toEqual([
      { id: 1, startTime: 1, endTime: 3, text: '안녕\n친구' },
      { id: 2, startTime: 4.5, endTime: 6, text: '다음' },
    ]);
  });
  it('recognizes SAMI even with text/html headers and extracts a decimal episode from a ZIP', async () => {
    expect(
      await new DirectFileResolver().resolve(
        resource('https://cdn.example/download', smi, { 'Content-Type': 'text/html' }),
      ),
    ).toMatchObject({ kind: 'file', name: 'subtitle.smi' });
    const zip = zipSync({ 'Show.E12.smi': strToU8(smi), 'Show.E12.5.smi': strToU8(smi) });
    expect(extractSubtitle(zip.buffer as ArrayBuffer, 12.5).name).toBe('Show.E12.5.smi');
  });
});
