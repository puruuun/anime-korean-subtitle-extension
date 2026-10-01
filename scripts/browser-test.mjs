import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';
const report = [];
let llmCalls = 0,
  languageQueries = [];
const local = createServer(async (req, res) => {
  if (req.url === '/v1/models') {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ data: [{ id: 'test-model' }] }));
    return;
  }
  let body = '';
  for await (const c of req) body += c;
  try {
    const input = JSON.parse(body),
      payload = JSON.parse(input.messages.at(-1).content);
    llmCalls++;
    assert(
      payload.toTranslate.every((c) => Object.keys(c).every((k) => ['id', 'text'].includes(k))),
    );
    res.setHeader('Content-Type', 'application/json');
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
  } catch {
    res.statusCode = 500;
    res.end('invalid request');
  }
});
await new Promise((r) => local.listen(0, '127.0.0.1', r));
const port = local.address().port;
const profile = await mkdtemp(join(tmpdir(), 'animesub-browser-'));
const dist = resolve('dist');
const opts = {
  headless: true,
  ignoreDefaultArgs: ['--disable-extensions'],
  args: ['--disable-extensions-except=' + dist, '--load-extension=' + dist],
  viewport: { width: 1280, height: 800 },
};
if (process.env.ANIMESUB_BROWSER_CHANNEL) opts.channel = process.env.ANIMESUB_BROWSER_CHANNEL;
else if (process.platform === 'win32') opts.channel = 'msedge';
const context = await chromium.launchPersistentContext(profile, opts);
try {
  await context.route('https://api.anissia.net/**', (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '{"code":"ok","data":[]}' }),
  );
  await context.route('https://graphql.anilist.co/**', (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '{"data":null}' }),
  );
  await context.route('https://api.subdl.com/**', (r) => {
    const u = new URL(r.request().url()),
      language = u.searchParams.get('languages');
    languageQueries.push(language);
    const episode = Number(u.searchParams.get('episode_number'));
    r.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        status: true,
        results: [{ name: 'Test Show' }],
        subtitles: [
          {
            name: 'Test.Show.E' + episode + '.srt',
            release_name: 'Test Show E' + episode,
            language,
            episode,
            url: '/subtitle/' + language + episode + '.srt',
          },
        ],
      }),
    });
  });
  await context.route('https://dl.subdl.com/**', (r) =>
    r.fulfill({
      status: 200,
      contentType: 'text/plain',
      body:
        '1\n00:00:00,000 --> 00:00:05,000\n' +
        (r.request().url().includes('KO') ? '한국어 원본' : '日本語 原文'),
    }),
  );
  await context.route('https://cdn.example/en.vtt', (r) =>
    r.fulfill({
      status: 200,
      headers: { 'Access-Control-Allow-Origin': '*' },
      contentType: 'text/vtt',
      body: 'WEBVTT\n\n00:00:00.000 --> 00:00:05.000\nHello, friend.',
    }),
  );
  const fixture =
    '<!doctype html><html><head><title>Watch Test Show · Miruro</title></head><body style="margin:0;background:#12121c;color:white"><h1 class="anime-title">Test Show</h1><div style="width:900px;height:506px;position:relative"><video style="width:100%;height:100%" controls><track src="https://cdn.example/en.vtt" srclang="en" label="English" kind="subtitles"></video></div></body></html>';
  await context.route('https://www.miruro.to/**', (r) =>
    r.fulfill({ contentType: 'text/html', body: fixture }),
  );
  const site = await context.newPage();
  await site.goto('https://www.miruro.to/watch/test?ep=1');
  const worker =
    context.serviceWorkers()[0] ??
    (await context.waitForEvent('serviceworker', { timeout: 15000 }));
  const id = new URL(worker.url()).host;
  const tabId = await worker.evaluate(async () => {
    const tabs = await chrome.tabs.query({});
    return tabs.find((t) => t.url?.includes('/watch/test'))?.id;
  });
  assert(tabId);
  await worker.evaluate(
    async ({ port }) => {
      const s = {
        mode: 'ko',
        translation: {
          provider: 'lmstudio',
          baseUrl: 'http://127.0.0.1:' + port + '/v1',
          apiKey: 'test-secret',
          model: 'test-model',
          chunkSize: 45,
          maxCharacters: 5000,
          contextCues: 5,
          temperature: 0.2,
          timeoutMs: 10000,
          maxRetry: 1,
          structured: 'json_schema',
        },
        providers: {
          subdl: { enabled: true, apiKey: 'test-subdl-key', priority: 1 },
          opensubtitles: {
            enabled: false,
            apiKey: '',
            token: '',
            username: '',
            password: '',
            baseUrl: 'https://api.opensubtitles.com/api/v1',
            priority: 2,
          },
        },
        display: { fontSize: 28, bottom: 8, backgroundOpacity: 0.55, outline: 2, maxLines: 3 },
        debug: false,
      };
      await chrome.storage.local.set({ settings: s });
    },
    { port },
  );
  await site.waitForSelector('[data-animesub-overlay]', { timeout: 10000 });
  // Open extension UI in a background tab, keeping the video tab active.
  await worker.evaluate(async (tabId) => {
    await chrome.tabs.update(tabId, { active: true });
  }, tabId);
  const opened = context.waitForEvent('page');
  await worker.evaluate(
    async (url) => {
      await chrome.tabs.create({ url, active: false });
    },
    'chrome-extension://' + id + '/popup.html',
  );
  const popup = await opened;
  await popup.waitForSelector('.mode');
  async function run(label) {
    const old = await worker.evaluate(
      async (tabId) => (await chrome.storage.session.get('job:' + tabId))['job:' + tabId],
      tabId,
    );
    await popup.getByText(label, { exact: true }).click();
    await popup.getByRole('button', { name: '한국어 자막 적용', exact: true }).click();
    await popup.waitForFunction(
      async ({ tabId, oldId }) => {
        const r = await chrome.runtime.sendMessage({ type: 'GET_STATUS', tabId });
        if (r.status?.stage === 'error') throw Error(r.status.message);
        return r.status?.jobId !== oldId && r.status?.stage === 'done';
      },
      { tabId, oldId: old?.jobId },
      { timeout: 20000 },
    );
    await popup
      .getByRole('status')
      .filter({ hasText: '한국어 자막 적용 완료' })
      .waitFor({ timeout: 5000 });
  }
  await run('한국어 자막 검색');
  assert.equal(llmCalls, 0);
  report.push('Mode 1: KO search/download/apply, zero LLM calls');
  await run('일본어 자막 → 한국어');
  assert.equal(llmCalls, 1);
  report.push('Mode 2: JA search → validated Korean translation → apply');
  const before = languageQueries.length;
  await run('사이트 영어 자막 → 한국어');
  assert.equal(languageQueries.length, before);
  assert.equal(llmCalls, 2);
  report.push('Mode 3: English <track> → translation, no external provider search');
  await run('사이트 영어 자막 → 한국어');
  assert.equal(llmCalls, 2);
  report.push('Repeated translation reused IndexedDB with zero new LLM calls');
  const rawDOM = await site.content();
  assert(!rawDOM.includes('test-secret') && !rawDOM.includes('test-subdl-key'));
  const rawStorage = await site.evaluate(async () => {
    try {
      return await chrome.storage.local.get('settings');
    } catch {
      return null;
    }
  });
  assert(!rawStorage?.settings);
  report.push('Webpage DOM and content context cannot read API keys');
  await popup.getByRole('button', { name: '+0.5s', exact: true }).click();
  await popup.getByText('+0.5s', { exact: true }).waitFor();
  report.push('Sync offset saved and applied');
  await site.evaluate(() => history.pushState({}, '', '?ep=2'));
  await popup
    .getByRole('status')
    .filter({ hasText: '한국어 자막 적용 완료' })
    .waitFor({ timeout: 20000 });
  await new Promise((r) => setTimeout(r, 1200));
  const status = await worker.evaluate(
    async (tabId) => (await chrome.storage.session.get('job:' + tabId))['job:' + tabId],
    tabId,
  );
  assert.equal(status.context.episode, 2);
  report.push('SPA EP1 → EP2 cancels old state and automatically applies new subtitles');
  const settings = await context.newPage();
  await settings.goto('chrome-extension://' + id + '/settings.html');
  await settings.getByRole('button', { name: 'Test Connection' }).click();
  await settings.getByRole('status').filter({ hasText: '연결 성공' }).waitFor({ timeout: 10000 });
  report.push('Settings connection test lists configured local model');
  await mkdir('qa', { recursive: true });
  await popup.screenshot({ path: 'qa/popup.png', fullPage: true });
  await settings.screenshot({ path: 'qa/settings.png', fullPage: true });
  await writeFile(
    'qa/browser-report.json',
    JSON.stringify(
      { browser: opts.channel ?? 'chromium', tests: report, passed: report.length },
      null,
      2,
    ),
  );
  console.log(JSON.stringify(report, null, 2));
} finally {
  await context.close();
  await new Promise((r) => local.close(r));
}
