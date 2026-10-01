import 'fake-indexeddb/auto';
import { createServer } from 'vite';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom' });
try {
  const { JimakuProvider } = await vite.ssrLoadModule('/src/providers/jimaku/JimakuProvider.ts');
  const { KitsunekkoProvider } = await vite.ssrLoadModule(
    '/src/providers/kitsunekko/KitsunekkoProvider.ts',
  );
  const { JapaneseSubtitleSearchManager } = await vite.ssrLoadModule(
    '/src/providers/japanese/JapaneseSubtitleSearchManager.ts',
  );
  const { database } = await vite.ssrLoadModule('/src/storage/database.ts');
  await database.clear();
  const context = {
    site: 'miruro',
    title: 'Frieren: Beyond Journey’s End',
    nativeTitle: '葬送のフリーレン',
    romajiTitle: 'Sousou no Frieren',
    anilistId: 154587,
    episode: 7,
    year: 2023,
    pageUrl: 'https://www.miruro.to/',
  };
  const started = Date.now();
  const source = await new JapaneseSubtitleSearchManager([
    new JimakuProvider(''),
    new KitsunekkoProvider(),
  ]).resolve(context, new AbortController().signal);
  assert(source, 'No usable live Japanese subtitle');
  assert.equal(source.candidate.providerId, 'kitsunekko');
  assert.equal(source.candidate.episode, '7');
  assert(source.cues.length > 0);
  const report = {
    checkedAt: new Date().toISOString(),
    source: source.candidate.providerId,
    episode: source.candidate.episode,
    filename: source.candidate.filename,
    cueCount: source.cues.length,
    firstCueTime: source.cues[0].startTime,
    lastCueTime: source.cues.at(-1).endTime,
    elapsedMs: Date.now() - started,
    translationExecuted: false,
  };
  await mkdir('qa', { recursive: true });
  await writeFile('qa/live-provider-report.json', JSON.stringify(report, null, 2));
  console.log(report);
} finally {
  await vite.close();
}
