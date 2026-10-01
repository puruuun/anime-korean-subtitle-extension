import 'fake-indexeddb/auto';
import { createServer } from 'vite';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom' });
try {
  const { AnissiaProvider } = await vite.ssrLoadModule('/src/providers/anissia/AnissiaProvider.ts');
  const { SubtitleLinkResolverChain } = await vite.ssrLoadModule(
    '/src/subtitle/links/SubtitleLinkResolverChain.ts',
  );
  const { createResourceLoader } = await vite.ssrLoadModule(
    '/src/subtitle/links/resourceLoader.ts',
  );
  const { loadUsableSubtitle } = await vite.ssrLoadModule('/src/subtitle/loadUsableSubtitle.ts');
  const { extractSubtitle } = await vite.ssrLoadModule('/src/subtitle/archive.ts');
  const { database } = await vite.ssrLoadModule('/src/storage/database.ts');
  await database.clear();
  const domains = new Set(),
    requests = [];
  const resourceLoader = createResourceLoader(async (origin) => {
    assert(
      [
        'https://kairan03.blogspot.com/*',
        'https://csora556.blogspot.com/*',
        'https://drive.usercontent.google.com/*',
        'https://0706life.tistory.com/*',
        'https://blog.kakaocdn.net/*',
      ].includes(origin),
      'Unexpected distribution domain: ' + origin,
    );
    domains.add(origin);
    return true;
  });
  const load = async (url, signal) => {
    const requestURL = new URL(url);
    if (requestURL.hostname === 'blog.kakaocdn.net') requestURL.search = '';
    requests.push(requestURL.href);
    return resourceLoader(url, signal);
  };
  const chain = new SubtitleLinkResolverChain(undefined, load);
  const filenames = new Map();
  const provider = new AnissiaProvider(undefined, {
    resolve: async (candidate, signal) => {
      const resolution = await chain.resolve(candidate, signal);
      if (resolution.kind === 'file') {
        const internal = extractSubtitle(
          resolution.buffer,
          Number(candidate.episode),
          candidate.episodeType,
          candidate.season ?? 1,
          candidate.fileEpisodes,
          candidate.requireEpisodeMatch,
          candidate.language,
        );
        filenames.set(candidate.id, internal.name === 'subtitle' ? resolution.name : internal.name);
      }
      return resolution;
    },
  });
  const results = [];
  for (const group of [
    { id: 2798, author: '카이란', episodes: 12, season: 2 },
    { id: 2798, author: 'C소라', episodes: 12, season: 2 },
    { id: 3041, author: '카이란', episodes: 13, season: 1 },
    { id: 3041, author: 'Sydeny', episodes: 9, season: 1 },
  ]) {
    const anime = (await (await fetch('https://api.anissia.net/anime/animeNo/' + group.id)).json())
      .data;
    for (let episode = 1; episode <= group.episodes; episode++) {
      const c = {
        site: 'miruro',
        title: anime.subject,
        nativeTitle: anime.originalSubject,
        year: Number(anime.startDate.slice(0, 4)),
        season: group.season,
        episode,
        pageUrl: 'https://www.miruro.to/',
      };
      const started = Date.now();
      try {
        const candidate = (await provider.search(c, 'ko')).find(
          (r) => r.author === group.author && r.animeNo === group.id,
        );
        assert(candidate, 'Missing author candidate');
        const file = await loadUsableSubtitle(provider, candidate, c, new AbortController().signal);
        assert(file.cues.length > 50, 'No usable episode');
        assert(
          file.cues.some((cue) => /[가-힣]/.test(cue.text)),
          'No Korean cues',
        );
        const result = {
          animeNo: group.id,
          author: group.author,
          episode,
          cueCount: file.cues.length,
          filename: filenames.get(candidate.id),
          firstCueTime: file.cues[0].startTime,
          lastCueTime: file.cues.at(-1).endTime,
          elapsedMs: Date.now() - started,
          passed: true,
        };
        results.push(result);
        console.log(JSON.stringify(result));
      } catch (error) {
        const result = {
          animeNo: group.id,
          author: group.author,
          episode,
          passed: false,
          error: error.message,
        };
        results.push(result);
        console.log(JSON.stringify(result));
      }
    }
  }
  const report = {
    checkedAt: new Date().toISOString(),
    passed: results.filter((r) => r.passed).length,
    total: results.length,
    results,
    domains: [...domains],
    requests,
    scope:
      'Real Anissia/Blogspot/feed/Google Drive/Tistory/ZIP parsing, all registered episodes of four author distributions in both user examples; optional host access simulated; actual video playback not tested',
  };
  assert.equal(report.passed, report.total, 'Some distribution cases failed');
  assert(
    !requests.some(
      (url) =>
        decodeURIComponent(url).includes('폰트.zip') ||
        new URL(url).searchParams.get('id') === '1hHWRHEJuW3CnmrgkMn43cAU9IgcGvGB7',
    ),
    'A font archive was downloaded',
  );
  await mkdir('qa', { recursive: true });
  await writeFile('qa/anissia-distribution-report.json', JSON.stringify(report, null, 2));
  console.log('PASS ' + report.passed + '/' + report.total);
} finally {
  await vite.close();
}
