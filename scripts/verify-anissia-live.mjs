import 'fake-indexeddb/auto';
import { createServer } from 'vite';
import { writeFile, mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom' });
try {
  const { resolveAnime } = await vite.ssrLoadModule('/src/anime/AnimeResolver.ts');
  const { AnissiaProvider } = await vite.ssrLoadModule('/src/providers/anissia/AnissiaProvider.ts');
  const { SubtitlePipeline } = await vite.ssrLoadModule('/src/subtitle/SubtitlePipeline.ts');
  const { SubtitleLinkResolverChain } = await vite.ssrLoadModule(
    '/src/subtitle/links/SubtitleLinkResolverChain.ts',
  );
  const { createResourceLoader } = await vite.ssrLoadModule(
    '/src/subtitle/links/resourceLoader.ts',
  );
  const { defaultSettings } = await vite.ssrLoadModule('/src/storage/settings.ts');
  const c = await resolveAnime(
    {
      site: 'miruro',
      title: 'You and I Are Polar Opposites Season 2',
      season: 2,
      episode: 12,
      pageUrl:
        'https://www.miruro.to/watch/qFe2jyMO-z1LwHyLlLpGyRUbWSg0g55W/seihantai-na-kimi-to-boku-2nd-season?ep=12',
    },
    new AbortController().signal,
  );
  assert.equal(c.anilistId, 210031);
  assert.equal(c.episodeOffset, 12);
  const origins = new Set();
  const loader = createResourceLoader(async (origin) => {
    assert(
      ['https://sumomomo.tistory.com/*', 'https://blog.kakaocdn.net/*'].includes(origin),
      'Unexpected distribution domain: ' + origin,
    );
    origins.add(origin);
    return true; // Simulate these two optional permissions, never grant production permissions here.
  });
  const provider = new AnissiaProvider(undefined, new SubtitleLinkResolverChain(undefined, loader));
  const candidates = await provider.search(c, 'ko');
  assert(candidates.some((candidate) => candidate.animeNo === 3495));
  const statuses = [];
  const started = Date.now();
  const result = await new SubtitlePipeline(
    [provider],
    defaultSettings,
    (status) => statuses.push(status),
    new AbortController().signal,
  ).resolve(c, 'ko');
  assert.equal(result.source, 'anissia');
  assert.equal(result.language, 'ko');
  assert(result.cues.length > 100);
  assert(result.cues.some((cue) => /[가-힣]/.test(cue.text)));
  const report = {
    checkedAt: new Date().toISOString(),
    context: c,
    animeNo: 3495,
    source: result.source,
    language: result.language,
    cueCount: result.cues.length,
    firstCueTime: result.cues[0].startTime,
    lastCueTime: result.cues.at(-1).endTime,
    elapsedMs: Date.now() - started,
    distributionOrigins: [...origins],
    translationExecuted: false,
    verificationScope:
      'Real AniList/Anissia/Tistory/CDN requests with the same source pipeline; optional permissions simulated; actual video playback not tested',
  };
  await mkdir('qa', { recursive: true });
  await writeFile('qa/anissia-live-report.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally {
  await vite.close();
}
