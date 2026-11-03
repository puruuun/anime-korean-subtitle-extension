import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { zipSync, strToU8 } from 'fflate';
import {
  GoogleDriveResolver,
  driveFileID,
  loadDriveFile,
} from '../src/subtitle/links/GoogleDriveResolver';
import { SubtitleLinkResolverChain } from '../src/subtitle/links/SubtitleLinkResolverChain';
import { GenericHtmlResolver, subtitleLinks } from '../src/subtitle/links/GenericHtmlResolver';
import { createResourceLoader } from '../src/subtitle/links/resourceLoader';
import { extractSubtitle, rankArchiveEntry } from '../src/subtitle/archive';
import { filenameEpisode } from '../src/anime/episodeNormalizer';
import { database } from '../src/storage/database';
import { DirectFileResolver } from '../src/subtitle/links/DirectFileResolver';
import { TistoryResolver } from '../src/subtitle/links/TistoryResolver';
import { NaverBlogResolver } from '../src/subtitle/links/NaverBlogResolver';

const id = '1Dm5IbVlS3p-sKNsChNN9cr2v27N7zZuG',
  latestId = '1P7zg3iNYIObJ26fxDLzIYcuUwmYTwBt7';
const drive = (id: string) => 'https://drive.google.com/file/d/' + id + '/view';
const body =
  '[Script Info]\nTitle: Show\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\nDialogue: 0,0:00:01.00,0:00:03.00,Default,,0,0,0,,한국어';
const srt = '1\n00:00:01,000 --> 00:00:03,000\n한국어';
const candidate = {
  id: 'anissia:3041:1',
  providerId: 'anissia',
  title: '사일런트 위치 침묵의 마녀의 비밀',
  release: 'Author',
  language: 'ko' as const,
  episode: '1',
  listedEpisode: '13',
  fileEpisodes: ['1'],
  requireEpisodeMatch: true,
  season: 1,
  pageUrl: 'https://author.blogspot.com/2025/10/13.html',
};
const resource = (url: string, text: string, headers: Record<string, string> = {}) => ({
  url,
  bytes: strToU8(text),
  headers: new Headers(headers),
});
const page = `<h3 class="post-title"><a>사일런트 위치 13화(완) 자막</a></h3><div class="post-body entry-content"><div><a href="${drive(latestId)}"><img src="/screen.jpg" /></a></div></div>`;
const feed = (entries: any[]) =>
  JSON.stringify({
    feed: { entry: entries, openSearch$totalResults: { $t: String(entries.length) } },
  });
const entry = (title: string, file = id, host = 'author.blogspot.com') => ({
  title: { $t: title },
  content: { $t: `<a href="${drive(file)}">파일</a>` },
  link: [{ rel: 'alternate', href: 'https://' + host + '/2025/07/1.html' }],
});
beforeEach(async () => {
  await database.clear();
});
afterEach(() => vi.unstubAllGlobals());

describe('Drive distribution', () => {
  it.each([
    drive(id),
    'https://drive.google.com/open?id=' + id,
    'https://drive.google.com/uc?id=' + id,
  ])('recognizes public file IDs: %s', (url) => expect(driveFileID(url)).toBe(id));
  it.each([
    'https://drive.google.com.evil.example/file/d/' + id + '/view',
    'https://drive.google.com/drive/folders/' + id,
    'http://drive.google.com/file/d/' + id + '/view',
  ])('ignores non-file/non-Google links: %s', (url) => expect(driveFileID(url)).toBeUndefined());
  it('downloads from the usercontent endpoint with the original resourcekey', async () => {
    const load = vi.fn(async (url: string) =>
      resource(url, body, { 'content-disposition': 'attachment; filename="Show Lv1.ass"' }),
    );
    const r = await loadDriveFile(drive(id) + '?resourcekey=public-share-key', { candidate, load });
    const url = new URL(load.mock.calls[0][0]);
    expect(url.origin).toBe('https://drive.usercontent.google.com');
    expect(url.searchParams.get('id')).toBe(id);
    expect(url.searchParams.get('resourcekey')).toBe('public-share-key');
    expect(r.name).toBe('Show Lv1.ass');
  });
  it('follows only a matching public download confirmation GET form', async () => {
    const load = vi.fn(async (url: string) =>
      resource(
        url,
        load.mock.calls.length === 1
          ? `<html><form method="get" action="https://drive.usercontent.google.com/download"><input name="id" value="${id}"><input name="export" value="download"><input name="confirm" value="t"><input name="uuid" value="public-uuid"></form></html>`
          : body,
        load.mock.calls.length === 1
          ? { 'content-type': 'text/html' }
          : { 'content-disposition': 'attachment; filename="Show Lv1.ass"' },
      ),
    );
    expect((await loadDriveFile(drive(id), { candidate, load })).kind).toBe('file');
    expect(load).toHaveBeenCalledTimes(2);
    expect(new URL(load.mock.calls[1][0]).searchParams.get('confirm')).toBe('t');
  });
  it.each(['https://evil.example/download', 'https://drive.usercontent.google.com/other'])(
    'refuses an unrelated confirmation action: %s',
    async (action) => {
      const load = vi.fn(async (url: string) =>
        resource(
          url,
          `<html><form action="${action}"><input name="id" value="${id}"><input name="export" value="download"><input name="confirm" value="t"></form></html>`,
          { 'content-type': 'text/html' },
        ),
      );
      await expect(loadDriveFile(drive(id), { candidate, load })).rejects.toThrow('Google Drive');
      expect(load).toHaveBeenCalledOnce();
    },
  );
  it('preserves the exact missing download host instead of asking for broad Google access', async () => {
    const loader = createResourceLoader(async (origin) => origin === 'https://drive.google.com/*');
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response('<html>Drive view</html>', { headers: { 'content-type': 'text/html' } }),
      ),
    );
    const r = await new SubtitleLinkResolverChain([new GoogleDriveResolver()], loader).resolve({
      ...candidate,
      pageUrl: drive(id),
    });
    expect(r).toMatchObject({
      kind: 'page',
      requiredOrigins: ['https://drive.usercontent.google.com/*'],
    });
  });
});

describe('Blogspot attachments and prior episodes', () => {
  it('finds an older episode in the sole batch ZIP alongside the latest ZIP and fonts, within the article body', async () => {
    const load = vi.fn(async (url: string) => ({
      ...resource(url, '', { 'content-type': 'application/zip' }),
      bytes: zipSync({ 'Show E01.ass': strToU8(body), 'Show E09.ass': strToU8(body) }),
    }));
    const result = await new GenericHtmlResolver().resolve(
      resource(
        candidate.pageUrl,
        '<div class="contents_style"><a href="/Show.9화.zip">9화</a><a href="/Show.zip">통합본</a><a href="/fonts.zip">폰트</a></div><a href="/Other.zip">사이드바</a>',
      ),
      { candidate, load },
    );
    expect(result.kind).toBe('file');
    expect(load.mock.calls.map(([url]) => url)).toEqual(['https://author.blogspot.com/Show.zip']);
  });
  it('rejects a batch with no requested episode even if it has just one unnamed subtitle', async () => {
    const load = vi.fn(async (url: string) => ({
      ...resource(url, '', { 'content-type': 'application/zip' }),
      bytes: zipSync({ 'Show.ass': strToU8(body) }),
    }));
    await expect(
      new GenericHtmlResolver().resolve(
        resource(
          candidate.pageUrl,
          '<a href="/Show.9화.zip">9화</a><a href="/Show.zip">통합본</a>',
        ),
        { candidate: { ...candidate, requireEpisodeMatch: false }, load },
      ),
    ).rejects.toThrow('회차를 확정');
  });
  it('uses the post body, skips font and related-sidebar Drive links, and accepts batch links', () => {
    const html = `<div class="post-body"><div><a href="${drive(latestId)}">폰트</a></div><a href="${drive(id)}">1 ~ 12화</a></div><a href="${drive('1OTHERwrongFile0')}">관련 글</a>`;
    expect(subtitleLinks(html, candidate.pageUrl).map((r) => r.url)).toEqual([drive(id)]);
  });
  it('selects the requested episode among multiple labeled Drive links', async () => {
    const load = vi.fn(async (url: string) =>
      resource(url, body, { 'content-disposition': 'attachment; filename="Show Lv1.ass"' }),
    );
    const r = await new GenericHtmlResolver().resolve(
      resource(
        candidate.pageUrl,
        `<a href="${drive(latestId)}">13화</a><a href="${drive(id)}">1화</a>`,
      ),
      { candidate, load },
    );
    expect(r.kind).toBe('file');
    expect(new URL(load.mock.calls[0][0]).searchParams.get('id')).toBe(id);
  });
  it('finds episode one in a public feed from the latest episode thirteen page and rejects unrelated search hits', async () => {
    const load = vi.fn(async (url: string) => {
      if (url === candidate.pageUrl) return resource(url, page);
      if (url.includes('/feeds/'))
        return resource(
          url,
          feed([
            entry('다른 작품 1화 자막', '1WrongUnrelatedFile0'),
            entry('사일런트 위치 1화 자막'),
            entry('사일런트 위치 2기 1화 자막', '1WrongSeasonFile0'),
            entry('사일런트 위치 1화 자막', '1WrongBlogFile0', 'other.blogspot.com'),
          ]),
        );
      return resource(url, body, {
        'content-disposition': `attachment; filename="Show Lv${new URL(url).searchParams.get('id') === latestId ? '13' : '1'}.ass"`,
      });
    });
    const result = await new SubtitleLinkResolverChain(undefined, load).resolve(candidate);
    expect(result).toMatchObject({ kind: 'file', name: 'Show Lv1.ass' });
    expect(
      load.mock.calls
        .filter(([url]) => url.includes('usercontent'))
        .map(([url]) => new URL(url).searchParams.get('id')),
    ).toEqual([latestId, id]);
  });
  it('does not apply the latest file when the requested episode is absent in the feed', async () => {
    const load = vi.fn(async (url: string) =>
      url === candidate.pageUrl
        ? resource(url, page)
        : url.includes('/feeds/')
          ? resource(url, feed([entry('무관한 작품 1화 자막')]))
          : resource(url, body, { 'content-disposition': 'attachment; filename="Show Lv13.ass"' }),
    );
    expect(await new SubtitleLinkResolverChain(undefined, load).resolve(candidate)).toMatchObject({
      kind: 'page',
    });
    expect(load.mock.calls.filter(([url]) => url.includes('usercontent'))).toHaveLength(1);
  });
  it('propagates cancellation while searching prior posts', async () => {
    const controller = new AbortController();
    const load = vi.fn(async (url: string) => {
      if (url === candidate.pageUrl) return resource(url, page);
      if (url.includes('/feeds/')) {
        controller.abort();
        controller.signal.throwIfAborted();
      }
      return resource(url, body, { 'content-disposition': 'attachment; filename="Show Lv13.ass"' });
    });
    await expect(
      new SubtitleLinkResolverChain(undefined, load).resolve(candidate, controller.signal),
    ).rejects.toMatchObject({ name: 'AbortError' });
  });
});

describe('legacy ZIP names and varied episode filenames', () => {
  it.each([
    ['다메닝겐2 1화.ass', '1'],
    ['사일런트 매지션 Lv13.ass', '13'],
    ['사일런트 매지션 Lv1 미완성.ass', '1'],
    ['사일런트 매지션 Lv12 미완성.ass', '12'],
    ['Show 01.ass', '1'],
  ])('parses explicit filename %s', (name, episode) =>
    expect(filenameEpisode(name)?.episode).toBe(episode),
  );
  it('keeps unrecognized trailing numbers ambiguous instead of treating them as a level episode', () => {
    expect(filenameEpisode('Show Lv1 unknown 12.ass')?.episode).not.toBe('1');
  });
  it('uses a verified second-season hint for Title 2 01.ass and retains ambiguity without that hint', () => {
    expect(filenameEpisode('Show 2 01.ass')).toBeUndefined();
    expect(filenameEpisode('Show 2 01.ass', 2)).toEqual({ season: 2, episode: '1' });
    expect(filenameEpisode('Show 3 01.ass', 2)).toBeUndefined();
  });
  it('repairs UTF-8 filenames sent as a legacy Content-Disposition header', async () => {
    const name = '사일런트 매지션 Lv1.ass',
      legacy = Array.from(strToU8(name), (b) => String.fromCharCode(b)).join('');
    expect(
      await new DirectFileResolver().resolve(
        resource('https://drive.usercontent.google.com/download', body, {
          'content-disposition': 'attachment; filename="' + legacy + '"',
        }),
      ),
    ).toMatchObject({ name });
  });
  it('decodes CP949 ZIP path bytes before selecting a historical episode', () => {
    const raw = new Uint8Array([
      0xb0, 0xa1, 0xb0, 0xa1, 0x20, 0x31, 0xc8, 0xad, 0x2e, 0x61, 0x73, 0x73,
    ]);
    const zip = zipSync({ ['x'.repeat(raw.length - 4) + '.ass']: strToU8(body) }),
      view = new DataView(zip.buffer);
    for (let at = 0; at < zip.length - 46; at++) {
      const magic = view.getUint32(at, true);
      if (magic === 0x04034b50) {
        view.setUint16(at + 6, view.getUint16(at + 6, true) & ~0x800, true);
        zip.set(raw, at + 30);
      }
      if (magic === 0x02014b50) {
        view.setUint16(at + 8, view.getUint16(at + 8, true) & ~0x800, true);
        zip.set(raw, at + 46);
      }
    }
    expect(extractSubtitle(zip.buffer as ArrayBuffer, 1, undefined, 2, [], true)).toMatchObject({
      name: '가가 1화.ass',
    });
  });
});

describe('archive multi-file ranking and bonus filtering', () => {
  it('excludes bonus patterns (OP, ED, PV, etc.) when an episode subtitle is present', () => {
    const zip = zipSync({
      '[Show] E01 NCED.ass': strToU8(body),
      '[Show] E01 NCOP.ass': strToU8(body),
      '[Show] E01.ass': strToU8(body),
    });
    const result = extractSubtitle(zip.buffer as ArrayBuffer, 1, undefined, 1, ['1'], true, 'ko');
    expect(result.name).toBe('[Show] E01.ass');
  });

  it('prefers WEB/BD over TV capture', () => {
    const zip = zipSync({
      '[TV-Cap] Show E01.srt': strToU8(body),
      '[BDRip] Show E01.srt': strToU8(body),
    });
    const result = extractSubtitle(zip.buffer as ArrayBuffer, 1, undefined, 1, ['1'], true, 'ko');
    expect(result.name).toBe('[BDRip] Show E01.srt');
  });

  it('ranks extensions according to language (ko: smi > srt > ass, ja: srt > ass > smi)', () => {
    const zipKo = zipSync({
      'Show E01.ass': strToU8(body),
      'Show E01.smi': strToU8(body),
      'Show E01.srt': strToU8(body),
    });
    expect(
      extractSubtitle(zipKo.buffer as ArrayBuffer, 1, undefined, 1, ['1'], true, 'ko').name,
    ).toBe('Show E01.smi');

    const zipJa = zipSync({
      'Show E01.smi': strToU8(body),
      'Show E01.srt': strToU8(body),
      'Show E01.ass': strToU8(body),
    });
    expect(
      extractSubtitle(zipJa.buffer as ArrayBuffer, 1, undefined, 1, ['1'], true, 'ja').name,
    ).toBe('Show E01.srt');
  });

  it('breaks ties lexicographically', () => {
    const zip = zipSync({
      'B_Show E01.srt': strToU8(body),
      'A_Show E01.srt': strToU8(body),
    });
    expect(
      extractSubtitle(zip.buffer as ArrayBuffer, 1, undefined, 1, ['1'], true, 'ko').name,
    ).toBe('A_Show E01.srt');
  });
});

describe('GenericHtmlResolver Tistory fileblock and range ZIPs', () => {
  it('strips file sizes from Tistory fileblocks and resolves range ZIPs', async () => {
    const zipData = zipSync({
      'Show E01.smi': strToU8(body),
      'Show E05.smi': strToU8(body),
      'Show E12.smi': strToU8(body),
    });
    const html = `
      <div class="contents_style">
        <div class="fileblock">
          <a href="https://blog.kakaocdn.net/dn/xyz/attach.zip?attach=1">
            <span class="name">[자막] 사일런트 위치 01-12화.zip 2.5MB</span>
          </a>
        </div>
      </div>
    `;
    const load = vi.fn(async (url: string) => ({
      ...resource(url, '', { 'content-type': 'application/zip' }),
      bytes: zipData,
    }));
    const cand = {
      ...candidate,
      episode: '5',
      fileEpisodes: ['5'],
      pageUrl: 'https://author.tistory.com/123',
    };
    const result = await new GenericHtmlResolver().resolve(resource(cand.pageUrl, html), {
      candidate: cand,
      load,
    });
    expect(result.kind).toBe('file');
    expect(load).toHaveBeenCalledWith(
      'https://blog.kakaocdn.net/dn/xyz/attach.zip?attach=1',
      undefined,
    );
  });

  it('selects higher ranking extension when multiple matching files are present in HTML', async () => {
    const load = vi.fn(async (url: string) => {
      const ext = url.split('.').pop();
      return resource(url, body, {
        'content-disposition': `attachment; filename="Show E01.${ext}"`,
      });
    });
    const html = `
      <a href="/Show.E01.srt">1화 SRT</a>
      <a href="/Show.E01.smi">1화 SMI</a>
      <a href="/Show.E01.ass">1화 ASS</a>
    `;
    const cand = { ...candidate, episode: '1', fileEpisodes: ['1'] };
    const result = await new GenericHtmlResolver().resolve(
      resource('https://author.example.com/post', html),
      { candidate: cand, load },
    );
    expect(result.kind).toBe('file');
    expect(result).toMatchObject({ url: 'https://author.example.com/Show.E01.smi' });
  });
});

describe('TistoryResolver', () => {
  it('searches prior episodes from a latest post on Tistory', async () => {
    const tistoryPost13 = `
      <div class="title-article">사일런트 위치 13화(완) 자막</div>
      <div class="contents_style">
        <a href="https://blog.kakaocdn.net/dn/ep13.zip">13화.zip</a>
      </div>
    `;
    const tistorySearch = `
      <div class="search-list">
        <a href="/100">사일런트 위치 13화 자막</a>
        <a href="/50">사일런트 위치 1화 자막</a>
        <a href="/category/anime">카테고리</a>
      </div>
    `;
    const tistoryPost1 = `
      <div class="title-article">사일런트 위치 1화 자막</div>
      <div class="contents_style">
        <a href="https://blog.kakaocdn.net/dn/ep01.zip">1화.zip</a>
      </div>
    `;
    const zip1 = zipSync({ '사일런트 위치 1화.ass': strToU8(body) });
    const zip13 = zipSync({ '사일런트 위치 13화.ass': strToU8(body) });

    const load = vi.fn(async (url: string) => {
      if (url === 'https://animedub.tistory.com/100') {
        return resource(url, tistoryPost13);
      }
      if (url.includes('/search/')) {
        return resource(url, tistorySearch);
      }
      if (url === 'https://animedub.tistory.com/50') {
        return resource(url, tistoryPost1);
      }
      if (url === 'https://blog.kakaocdn.net/dn/ep01.zip') {
        return { ...resource(url, '', { 'content-type': 'application/zip' }), bytes: zip1 };
      }
      if (url === 'https://blog.kakaocdn.net/dn/ep13.zip') {
        return { ...resource(url, '', { 'content-type': 'application/zip' }), bytes: zip13 };
      }
      return resource(url, 'not found', { status: '404' });
    });

    const cand = {
      ...candidate,
      episode: '1',
      fileEpisodes: ['1'],
      pageUrl: 'https://animedub.tistory.com/100',
    };

    const resolver = new TistoryResolver();
    const result = await resolver.resolve(resource(cand.pageUrl, tistoryPost13), {
      candidate: cand,
      load,
    });

    expect(result?.kind).toBe('file');
    expect(result).toMatchObject({
      url: 'https://blog.kakaocdn.net/dn/ep01.zip',
    });
  });
});

describe('NaverBlogResolver', () => {
  it('unwraps mainFrame and extracts aPostFiles attachment', async () => {
    const outerHtml = `
      <html>
        <iframe id="mainFrame" name="mainFrame" src="/PostView.naver?blogId=testauthor&logNo=220000000001"></iframe>
      </html>
    `;
    const innerHtml = `
      <span class="itemSubjectBoldfont">사일런트 위치 1화 자막</span>
      <script>
        var aPostFiles = [
          {
            "attachFileName": "사일런트 위치 01화.srt",
            "attachUrl": "https://blogattach.naver.net/testauthor/220000000001/Show01.srt"
          }
        ];
      </script>
    `;
    const load = vi.fn(async (url: string) => {
      if (url.includes('/PostView.naver')) {
        return resource(url, innerHtml);
      }
      if (url.includes('blogattach.naver.net')) {
        return resource(url, srt, {
          'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent('사일런트 위치 01화.srt')}`,
        });
      }
      return resource(url, 'not found');
    });

    const cand = {
      ...candidate,
      episode: '1',
      fileEpisodes: ['1'],
      pageUrl: 'https://blog.naver.com/testauthor/220000000001',
    };

    const resolver = new NaverBlogResolver();
    const result = await resolver.resolve(resource(cand.pageUrl, outerHtml), {
      candidate: cand,
      load,
    });

    expect(result?.kind).toBe('file');
    expect(result).toMatchObject({
      name: '사일런트 위치 01화.srt',
    });
  });

  it('searches prior episodes from latest post on Naver blog', async () => {
    const post12 = `
      <span class="itemSubjectBoldfont">사일런트 위치 12화 자막</span>
      <script>
        var aPostFiles = [
          {
            "attachFileName": "사일런트 위치 12화.srt",
            "attachUrl": "https://blogattach.naver.net/testauthor/12/Show12.srt"
          }
        ];
      </script>
    `;
    const searchHtml = `
      <div class="search_list">
        <a href="/PostView.naver?blogId=testauthor&logNo=12">사일런트 위치 12화 자막</a>
        <a href="/PostView.naver?blogId=testauthor&logNo=1">사일런트 위치 1화 자막</a>
      </div>
    `;
    const post1 = `
      <span class="itemSubjectBoldfont">사일런트 위치 1화 자막</span>
      <script>
        var aPostFiles = [
          {
            "attachFileName": "사일런트 위치 01화.srt",
            "attachUrl": "https://blogattach.naver.net/testauthor/1/Show01.srt"
          }
        ];
      </script>
    `;
    const load = vi.fn(async (url: string) => {
      if (url.includes('logNo=12') || url.endsWith('/12')) {
        return resource(url, post12);
      }
      if (url.includes('PostSearchList.naver')) {
        return resource(url, searchHtml);
      }
      if (url.includes('logNo=1') || url.endsWith('/1')) {
        return resource(url, post1);
      }
      if (url.includes('blogattach.naver.net/testauthor/1/Show01.srt')) {
        return resource(url, srt, {
          'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent('사일런트 위치 01화.srt')}`,
        });
      }
      return resource(url, 'not found');
    });

    const cand = {
      ...candidate,
      episode: '1',
      fileEpisodes: ['1'],
      pageUrl: 'https://blog.naver.com/PostView.naver?blogId=testauthor&logNo=12',
    };

    const resolver = new NaverBlogResolver();
    const result = await resolver.resolve(resource(cand.pageUrl, post12), {
      candidate: cand,
      load,
    });

    expect(result?.kind).toBe('file');
    expect(result).toMatchObject({
      name: '사일런트 위치 01화.srt',
    });
  });
});
