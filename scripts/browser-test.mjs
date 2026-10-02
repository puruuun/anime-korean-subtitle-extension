import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, writeFile, cp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';
const report = [];
let llmCalls = 0,
  geminiCalls = 0,
  phase = 'ko';
const counts = { anissia: 0, jimaku: 0, kitsunekko: 0 };
const local = createServer(async (req, res) => {
  if (req.url === '/v1/models') {
    res.end(JSON.stringify({ data: [{ id: 'test-model' }] }));
    return;
  }
  let body = '';
  for await (const chunk of req) body += chunk;
  const input = JSON.parse(body),
    payload = JSON.parse(input.messages.at(-1).content);
  llmCalls++;
  assert(payload.toTranslate.every((c) => Object.keys(c).every((k) => ['id', 'text'].includes(k))));
  res.end(
    JSON.stringify({
      choices: [
        {
          message: {
            content: JSON.stringify({
              translations: payload.toTranslate.map((c) => ({
                id: c.id,
                text: '한국어 ' + c.text,
              })),
            }),
          },
          finish_reason: 'stop',
        },
      ],
    }),
  );
});
await new Promise((r) => local.listen(0, '127.0.0.1', r));
const port = local.address().port;
const temp = await mkdtemp(join(tmpdir(), 'animesub-pipeline-'));
const dist = join(temp, 'extension');
await cp(resolve('dist'), dist, { recursive: true });
const manifest = JSON.parse(await readFile(join(dist, 'manifest.json'), 'utf8'));
manifest.host_permissions.push('https://blog.example/*', 'https://cdn.example/*');
await writeFile(join(dist, 'manifest.json'), JSON.stringify(manifest));
const context = await chromium.launchPersistentContext(join(temp, 'profile'), {
  channel: 'chromium',
  headless: true,
  ignoreDefaultArgs: ['--disable-extensions'],
  args: ['--disable-extensions-except=' + dist, '--load-extension=' + dist],
  viewport: { width: 1280, height: 900 },
});
const srt = (text) => '1\n00:00:01,000 --> 00:00:05,000\n' + text;
const root =
  'https://raw.githubusercontent.com/Ajatt-Tools/kitsunekko-mirror/refs/heads/main/subtitles/anime_tv/Test/';
try {
  await context.route('https://graphql.anilist.co/**', (r) => r.fulfill({ json: { data: null } }));
  await context.route('https://api.anissia.net/**', (r) => {
    counts.anissia++;
    const schedule = r.request().url().includes('/schedule/');
    const data = schedule
      ? [
          {
            animeNo: 42,
            subject: 'Test Show',
            originalSubject: 'テスト',
            startDate: '',
            endDate: '',
          },
        ]
      : [
          {
            episode: '7',
            name: 'Author',
            updDt: phase,
            website: 'https://blog.example/' + phase + '.srt',
          },
        ];
    return r.fulfill({ json: { code: 'ok', data: phase === 'allmissing' ? [] : data } });
  });
  await context.route('https://blog.example/**', (r) =>
    r.fulfill({
      contentType: phase === 'ko' ? 'text/plain' : 'text/html',
      body: phase === 'ko' ? srt('한국어 원본') : '<html><body>Unavailable file</body></html>',
    }),
  );
  await context.route('https://jimaku.cc/api/**', (r) => {
    counts.jimaku++;
    if (phase === 'jimaku-error') return r.fulfill({ status: 500, body: '{}' });
    if (!['ja', 'mirror-file-failure', 'gemini'].includes(phase)) return r.fulfill({ json: [] });
    return r.fulfill({
      json: r.request().url().includes('/search?')
        ? [{ id: 9, name: 'Test Show', anilist_id: 123, japanese_name: 'テスト' }]
        : [
            {
              name: 'Test Show E07.srt',
              url: 'https://jimaku.cc/subtitle/7.srt',
              size: 100,
              last_modified: phase,
            },
          ],
    });
  });
  await context.route('https://jimaku.cc/subtitle/**', (r) =>
    r.fulfill({
      contentType: 'text/plain',
      body: phase === 'mirror-file-failure' ? '<html>bad file</html>' : srt('日本語 原文'),
    }),
  );
  await context.route('https://subtitles.ajatt.top/**', (r) => {
    counts.kitsunekko++;
    return r.fulfill({
      contentType: 'text/html',
      body:
        r.request().url() === 'https://subtitles.ajatt.top/'
          ? '<table><tr><td>1</td><td><a href="anime_tv/test.html">Test Show</a></td><td>TV</td><td>Test Show</td><td>テスト</td></tr></table>'
          : ['mirror', 'jimaku-error', 'mirror-file-failure'].includes(phase)
            ? `<a href="${root}Test%20Show%20E07.srt">7</a>`
            : `<a href="${root}Test%20Show%20E08.srt">8</a>`,
    });
  });
  await context.route(root + '**', (r) =>
    r.fulfill({ contentType: 'text/plain', body: srt('日本語 Mirror') }),
  );
  await context.route('https://generativelanguage.googleapis.com/**', (r) => {
    const body = r.request().postDataJSON();
    geminiCalls++;
    assert(r.request().headers()['x-goog-api-key'] === 'test-gemini-key');
    const payload = JSON.parse(body.contents[0].parts[0].text);
    return r.fulfill({
      json: {
        candidates: [
          {
            finishReason: 'STOP',
            content: {
              parts: [
                {
                  text: JSON.stringify({
                    translations: payload.toTranslate.map((c) => ({
                      id: c.id,
                      text: 'Gemini 한국어 ' + c.text,
                    })),
                  }),
                },
              ],
            },
          },
        ],
      },
    });
  });
  const fixture =
    '<!doctype html><title>Watch Test Show</title><h1 class="anime-title">Test Show</h1><script type="application/ld+json">{"@type":"TVEpisode","episodeNumber":7,"partOfSeries":{"name":"Test Show"}}</script><div style="width:900px;height:506px;position:relative"><video style="width:100%;height:100%" controls></video></div>';
  await context.route('https://www.miruro.to/**', (r) =>
    r.fulfill({ contentType: 'text/html', body: fixture }),
  );
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
  const id = new URL(worker.url()).host;
  for (
    let i = 0;
    i < 100 &&
    !context.pages().some((p) => p.url() === 'chrome-extension://' + id + '/settings.html');
    i++
  )
    await new Promise((r) => setTimeout(r, 50));
  await worker.evaluate(async (port) => {
    await chrome.storage.local.set({
      settings: {
        mode: 'auto',
        translation: {
          provider: 'lmstudio',
          model: 'test-model',
          baseUrl: 'http://127.0.0.1:' + port + '/v1',
          apiKey: 'test-secret',
          timeoutMs: 10000,
        },
        jimaku: { apiKey: 'test-jimaku-key' },
      },
    });
  }, port);
  const site = await context.newPage();
  await site.goto('https://www.miruro.to/watch/test?ep=7');
  await site.waitForSelector('[data-animesub-overlay]');
  await site.evaluate(() => {
    const track = document.querySelector('video').addTextTrack('subtitles', 'English', 'en');
    track.addCue(new VTTCue(1, 5, 'Hello'));
    track.mode = 'hidden';
  });
  const tabId = await worker.evaluate(
    async () => (await chrome.tabs.query({})).find((t) => t.url?.includes('/watch/test'))?.id,
  );
  const popupPromise = context.waitForEvent('page');
  await worker.evaluate(
    async (url) => {
      await chrome.tabs.create({ url, active: false });
    },
    'chrome-extension://' + id + '/popup.html',
  );
  const popup = await popupPromise;
  await popup.waitForSelector('.mode');
  const send = (msg) =>
    popup.evaluate(async (m) => {
      const r = await chrome.runtime.sendMessage(m);
      if (!r.ok) throw Error(r.error);
      return r;
    }, msg);
  async function waitDone(jobId) {
    const expires = Date.now() + 20000;
    while (Date.now() < expires) {
      const { status } = await send({ type: 'GET_STATUS', tabId });
      if ((!jobId || status?.jobId === jobId) && status?.stage === 'error')
        throw Error(status.message);
      if (status?.stage === 'done' && !status.busy && (!jobId || status.jobId === jobId))
        return status;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw Error(
      'Job completion timeout: ' +
        JSON.stringify((await send({ type: 'GET_STATUS', tabId })).status),
    );
  }
  assert.equal((await waitDone()).source, 'anissia');
  assert.equal(llmCalls, 0);
  assert.equal(counts.jimaku, 0);
  assert.equal(counts.kitsunekko, 0);
  report.push(
    'A: initial video page starts AUTO, Anissia applies directly, zero Japanese/LLM calls',
  );
  async function run(nextPhase, mode = 'auto', changes = {}) {
    phase = nextPhase;
    await send({ type: 'CLEAR_CACHE' });
    const s = (await send({ type: 'GET_SETTINGS' })).settings;
    Object.assign(s, changes);
    await send({ type: 'SAVE_SETTINGS', settings: s });
    const started = await send({ type: 'RUN', tabId, mode });
    return waitDone(started.status.jobId);
  }
  assert.equal((await run('ja')).source, 'jimaku');
  assert.equal(llmCalls, 1);
  report.push('B: unresolved Anissia page falls through to Jimaku JA → local Korean translation');
  let before = counts.jimaku;
  assert.equal((await run('mirror', 'auto', { jimaku: { apiKey: '' } })).source, 'kitsunekko');
  assert.equal(counts.jimaku, before);
  report.push('C: no Jimaku key makes zero Jimaku HTTP requests and uses Kitsunekko');
  assert.equal(
    (await run('jimaku-error', 'auto', { jimaku: { apiKey: 'test-jimaku-key' } })).source,
    'kitsunekko',
  );
  report.push('D: Jimaku 500 automatically uses Kitsunekko');
  assert.equal((await run('mirror-file-failure')).source, 'kitsunekko');
  report.push('Jimaku candidate with an invalid subtitle file falls through to Kitsunekko');
  assert.equal((await run('en')).source, 'embedded-en');
  report.push('E: Japanese episode mismatch falls through to embedded English');
  const externalBefore = { ...counts };
  await run('ko', 'ko');
  assert.equal(counts.jimaku, externalBefore.jimaku);
  assert.equal(counts.kitsunekko, externalBefore.kitsunekko);
  report.push('F: Manual Korean uses only Anissia');
  before = counts.anissia;
  assert.equal((await run('mirror', 'ja')).source, 'kitsunekko');
  assert.equal(counts.anissia, before);
  report.push('G: Manual Japanese uses only Jimaku → Kitsunekko');
  const allBefore = { ...counts };
  await run('en', 'en');
  assert.deepEqual(counts, allBefore);
  report.push('H: Manual English never searches external sources');
  before = llmCalls;
  await send({ type: 'RUN', tabId, mode: 'en' });
  await waitDone();
  assert.equal(llmCalls, before);
  report.push('Repeated progressive translation reuses IndexedDB without LLM calls');
  const s = (await send({ type: 'GET_SETTINGS' })).settings;
  assert.equal(
    (
      await run('gemini', 'auto', {
        translation: {
          ...s.translation,
          provider: 'gemini',
          geminiApiKey: 'test-gemini-key',
          geminiModel: 'test-model',
        },
      })
    ).source,
    'jimaku',
  );
  assert.equal(geminiCalls, 1);
  assert((await send({ type: 'GET_STATUS', tabId })).status.path.includes('Gemini'));
  report.push('Gemini JA translation uses the same progressive queue with validated JSON');
  await run('en', 'en');
  assert.equal(geminiCalls, 2);
  report.push('Gemini EN translation uses its English prompt and shared queue');
  const storage = await send({ type: 'GET_SETTINGS' });
  assert(!('providers' in storage.settings));
  assert.equal(storage.settings.schemaVersion, 2);
  report.push('J: legacy settings migrated without obsolete provider credentials');
  assert(!(await site.content()).includes('test-jimaku-key'));
  const contentStorage = await site.evaluate(async () => {
    try {
      return await chrome.storage.local.get('settings');
    } catch {
      return null;
    }
  });
  assert(!contentStorage?.settings);
  report.push('Page MAIN/isolated contexts cannot read API key storage');
  await send({ type: 'OFFSET', tabId, offset: 0.5 });
  assert.equal((await send({ type: 'GET_STATUS', tabId })).status.offset, 0.5);
  report.push('Episode subtitle sync remains functional');
  await send({ type: 'CANCEL', tabId });
  await new Promise((r) => setTimeout(r, 1800));
  assert(!(await send({ type: 'GET_STATUS', tabId })).status);
  report.push('User cancellation suppresses automatic FRAME_READY restart');
  // Exercise visible UI: only auto/manual by default; three choices appear in manual.
  await popup.getByText('수동', { exact: true }).click();
  assert.equal(await popup.locator('input[name="mode"]').count(), 3);
  await popup.getByText('자동', { exact: true }).click();
  assert.equal(await popup.locator('input[name="mode"]').count(), 0);
  report.push('Popup has Auto/Manual and exactly three independent manual choices');
  const options = await context.newPage();
  await options.goto('chrome-extension://' + id + '/settings.html');
  assert.equal(await options.locator('details input').count(), 1);
  assert.equal(await options.getByRole('heading', { name: '자막 자동 검색 설정' }).count(), 1);
  await mkdir('qa', { recursive: true });
  await popup.screenshot({ path: 'qa/popup.png', fullPage: true });
  await options.screenshot({ path: 'qa/settings.png', fullPage: true });
  await writeFile(
    'qa/browser-report.json',
    JSON.stringify(
      {
        browser: 'Chromium isolated MV3',
        passed: report.length,
        tests: report,
        llmCalls,
        geminiCalls,
        counts,
      },
      null,
      2,
    ),
  );
  console.log(JSON.stringify(report, null, 2));
} finally {
  await context.close();
  await new Promise((r) => local.close(r));
}
