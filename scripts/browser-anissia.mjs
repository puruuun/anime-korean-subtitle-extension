import { chromium } from 'playwright';
import { mkdtemp, cp, readFile, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';

const report = [];
let phase = 'direct';
const apiRequests = [];
const fileRequests = [];
const htmlRequests = [];
let subdlRequests = 0;
let worker, popup, tabId;
const profile = await mkdtemp(join(tmpdir(), 'animesub-anissia-'));
const dist = await mkdtemp(join(tmpdir(), 'animesub-anissia-extension-'));
await cp(resolve('dist'), dist, { recursive: true });
const manifest = JSON.parse(await readFile(join(dist, 'manifest.json'), 'utf8'));
// Test-only origins avoid native permission dialogs; production keeps these optional.
manifest.host_permissions.push('https://blog.example/*', 'https://cdn.example/*');
await writeFile(join(dist, 'manifest.json'), JSON.stringify(manifest));
const options = {
  headless: true,
  ignoreDefaultArgs: ['--disable-extensions'],
  args: ['--disable-extensions-except=' + dist, '--load-extension=' + dist],
  viewport: { width: 1280, height: 900 },
};
if (process.env.ANIMESUB_BROWSER_CHANNEL) options.channel = process.env.ANIMESUB_BROWSER_CHANNEL;
else if (process.platform === 'win32') options.channel = 'msedge';
const context = await chromium.launchPersistentContext(profile, options);
const anime = {
  animeNo: 42,
  subject: '테스트 쇼',
  originalSubject: 'テスト・ショー',
  startDate: '2026-07-05',
  endDate: '2026-10-04',
};
const smi =
  '<SAMI><BODY><SYNC Start=1000><P Class=KRCC>Anissia 한국어<br>둘째 줄<SYNC Start=3000><P Class=KRCC>&nbsp;</BODY></SAMI>';
function caption(website, name = '제작자 A') {
  return { episode: '012.50', name, website, updDt: '2026-10-01T02:30:00' };
}
function pass(message) {
  report.push(message);
  console.log('PASS ' + message);
}
async function status() {
  return popup.evaluate(async (tabId) => {
    const r = await chrome.runtime.sendMessage({ type: 'GET_STATUS', tabId });
    if (!r.ok) throw Error(r.error);
    return r.status;
  }, tabId);
}
async function render() {
  return worker.evaluate(
    async (tabId) => (await chrome.storage.session.get('render:' + tabId))['render:' + tabId],
    tabId,
  );
}
async function waitForStage(stage, previousId) {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    const current = await status();
    if (current?.jobId !== previousId && current?.stage === 'error') throw Error(current.message);
    if (current?.jobId !== previousId && current?.stage === stage) {
      await popup.waitForFunction(
        (message) => document.querySelector('[role="status"]')?.textContent?.includes(message),
        current.message,
      );
      return current;
    }
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  throw Error('Timed out waiting for stage ' + stage);
}
async function run(stage) {
  const old = await status();
  await popup.getByRole('button', { name: '한국어 자막 적용', exact: true }).click();
  return waitForStage(stage, old?.jobId);
}

try {
  await context.route('https://graphql.anilist.co/**', (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        data: {
          Media: {
            id: 42,
            title: { english: 'Test Show', romaji: 'Test Show', native: 'テスト ショー' },
            synonyms: ['테스트 쇼'],
            startDate: { year: 2026 },
          },
        },
      }),
    }),
  );
  await context.route('https://api.anissia.net/**', (route) => {
    const url = route.request().url();
    apiRequests.push(url);
    if (phase === 'outage') return route.fulfill({ status: 503, body: 'unavailable' });
    let data;
    if (url.includes('/schedule/')) data = [anime];
    else if (phase === 'direct') data = [caption('https://cdn.example/download')];
    else if (phase === 'multi')
      data = [
        caption('https://blog.example/episode'),
        caption('https://blog.example/other', '제작자 B'),
        caption(' ', '준비 중'),
        { ...caption('https://blog.example/wrong'), episode: '12' },
      ];
    else if (phase === 'unresolved') data = [caption('https://blog.example/nofile')];
    else data = [caption('https://ungranted.example/episode')];
    return route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ code: 'ok', data }),
    });
  });
  await context.route('https://cdn.example/**', (route) => {
    fileRequests.push(route.request().url());
    return route.fulfill({
      contentType: 'application/octet-stream',
      headers: { 'Content-Disposition': "attachment; filename*=UTF-8''Show.E12.5.smi" },
      body: smi,
    });
  });
  await context.route('https://blog.example/**', (route) => {
    htmlRequests.push(route.request().url());
    return route.fulfill({
      contentType: 'text/html',
      body:
        route.request().url().includes('/nofile') ||
        (phase === 'multi' && route.request().url().endsWith('/episode'))
          ? '<html><body>JavaScript 또는 로그인이 필요한 배포 페이지</body></html>'
          : '<html><a href="https://cdn.example/download?episode=12.5" download="Show.E12.5.smi">SMI 자막</a></html>',
    });
  });
  let ungrantedFetches = 0;
  await context.route('https://ungranted.example/**', (route) => {
    ungrantedFetches++;
    return route.fulfill({ contentType: 'text/html', body: '<html>no permission</html>' });
  });
  await context.route('https://api.subdl.com/**', (route) => {
    subdlRequests++;
    return route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        status: true,
        results: [{ name: 'Test Show' }],
        subtitles: [
          {
            name: 'Test.Show.E12.5.srt',
            language: 'KO',
            episode: 12.5,
            url: '/subtitle/ko12.5.srt',
          },
        ],
      }),
    });
  });
  await context.route('https://dl.subdl.com/**', (route) =>
    route.fulfill({
      contentType: 'text/plain',
      body: '1\n00:00:01,000 --> 00:00:03,000\nSubDL 한국어 fallback',
    }),
  );
  const fixture =
    '<!doctype html><html><head><meta charset="utf-8"><title>Test Show</title></head><body style="background:#12121c;color:white"><h1 class="anime-title">Test Show</h1><div style="width:900px;height:506px"><video controls style="width:100%;height:100%"></video></div></body></html>';
  await context.route('https://www.miruro.to/**', (route) =>
    route.fulfill({ contentType: 'text/html', body: fixture }),
  );
  const site = await context.newPage();
  await site.goto('https://www.miruro.to/watch/test?ep=12.5');
  worker =
    context.serviceWorkers()[0] ??
    (await context.waitForEvent('serviceworker', { timeout: 15000 }));
  await worker.evaluate(() => {
    globalThis.testEvents = [];
    chrome.runtime.onMessage.addListener((m, sender) => {
      if (['RUN', 'CONTEXT_CHANGED', 'CANCEL'].includes(m.type))
        globalThis.testEvents.push({
          type: m.type,
          tabId: sender.tab?.id,
          mode: m.mode,
          selectedId: m.selectedId,
        });
    });
  });
  const id = new URL(worker.url()).host;
  tabId = await worker.evaluate(
    async () => (await chrome.tabs.query({})).find((tab) => tab.url?.includes('/watch/test'))?.id,
  );
  assert(tabId);
  await worker.evaluate(async () => {
    await chrome.storage.local.set({
      settings: {
        providers: {
          subdl: { enabled: false, apiKey: '', priority: 1 },
          opensubtitles: { enabled: false, apiKey: '', priority: 2 },
        },
      },
    });
  });
  await site.waitForSelector('[data-animesub-overlay]');
  const opened = context.waitForEvent('page');
  await worker.evaluate(
    async ({ tabId, url }) => {
      await chrome.tabs.update(tabId, { active: true });
      await chrome.tabs.create({ url, active: false });
    },
    { tabId, url: 'chrome-extension://' + id + '/popup.html' },
  );
  popup = await opened;
  await popup.waitForSelector('.mode');

  await run('done');
  const first = await render();
  assert.equal(first.cues[0].text, 'Anissia 한국어\n둘째 줄');
  assert.equal(first.cues[0].startTime, 1);
  assert.equal(first.cues[0].endTime, 3);
  assert.equal(first.translation, undefined);
  assert.equal(subdlRequests, 0);
  assert.equal(apiRequests.filter((url) => url.includes('/schedule/')).length, 9);
  assert.equal(apiRequests.filter((url) => url.includes('/caption/')).length, 1);
  pass(
    'Always-enabled Anissia matches native normalized title and decimal episode; header-named SMI renders without keys or LLM',
  );

  const downloads = fileRequests.length;
  await run('done');
  assert.equal(fileRequests.length, downloads);
  assert.equal(apiRequests.filter((url) => url.includes('/schedule/')).length, 9);
  assert.equal(apiRequests.filter((url) => url.includes('/caption/')).length, 2);
  pass(
    'All nine schedules persist in IndexedDB; caption metadata refreshes and the same downloaded subtitle is cached',
  );

  phase = 'multi';
  const multi = await run('select');
  assert.equal(multi.results.length, 2);
  await popup.locator('.subtitle-candidate').nth(1).waitFor();
  assert.equal(await popup.getByRole('link', { name: '배포 페이지 열기 ↗' }).count(), 2);
  assert((await popup.locator('.subtitle-candidate').first().innerText()).includes('제작자 A'));
  assert.equal(htmlRequests.length, 0);
  pass(
    'Every ready author is shown for manual selection; blank websites and other episodes are excluded without downloading pages',
  );

  const old = await status();
  await popup.getByRole('button', { name: '이 자막 적용', exact: true }).first().click();
  const blockedAuthor = await waitForStage('select', old.jobId);
  assert.equal(blockedAuthor.results.length, 2);
  await mkdir('qa', { recursive: true });
  await popup.screenshot({ path: 'qa/anissia-candidates.png', fullPage: true });
  pass('A selected author with no clear file keeps every other author available for selection');
  phase = 'multi-download';
  await popup.getByRole('button', { name: '이 자막 적용', exact: true }).first().click();
  await waitForStage('done', blockedAuthor.jobId);
  assert.equal((await render()).cues[0].text, 'Anissia 한국어\n둘째 줄');
  assert.equal(htmlRequests.length, 2);
  pass(
    'Generic HTML resolver follows an explicit attachment link and DirectFileResolver verifies header-named SMI',
  );

  phase = 'unresolved';
  const unresolved = await run('select');
  assert.equal(unresolved.results[0].pageUrl, 'https://blog.example/nofile');
  await popup.getByRole('link', { name: '배포 페이지 열기 ↗' }).waitFor();
  assert.equal(
    await popup.getByRole('link', { name: '배포 페이지 열기 ↗' }).getAttribute('href'),
    'https://blog.example/nofile',
  );
  pass(
    'Pages without a clear file remain selectable distribution-page links instead of being parsed as subtitle text',
  );

  phase = 'permission';
  const permission = await run('select');
  assert.deepEqual(permission.results[0].requiredOrigins, ['https://ungranted.example/*']);
  await popup.getByRole('button', { name: '접근 허용 후 적용', exact: true }).waitFor();
  assert.equal(ungrantedFetches, 0);
  await popup.screenshot({ path: 'qa/anissia-permission.png', fullPage: true });
  pass(
    'Missing host permission is handed to the popup with an exact-origin action and page URL; no unauthorized fetch occurs',
  );

  const settings = await context.newPage();
  await settings.goto('chrome-extension://' + id + '/settings.html');
  await settings.getByText('자동 활성화', { exact: true }).waitFor();
  assert((await settings.locator('main').innerText()).includes('Anissia → SubDL → OpenSubtitles'));
  pass('Settings identify Anissia as automatic and explain the fixed Korean provider priority');

  phase = 'outage';
  await worker.evaluate(async () => {
    const current = (await chrome.storage.local.get('settings')).settings;
    current.providers.subdl = { enabled: true, apiKey: 'test-key', priority: 99 };
    await chrome.storage.local.set({ settings: current });
  });
  await popup.evaluate(() => chrome.runtime.sendMessage({ type: 'CLEAR_CACHE' }));
  const fallback = await run('done');
  assert.equal((await render()).cues[0].text, 'SubDL 한국어 fallback');
  assert(fallback.warnings.includes('anissia 검색 실패'));
  assert(subdlRequests > 0);
  pass(
    'Anissia API outage automatically falls back to SubDL and applies its Korean subtitle without failing the job',
  );

  await mkdir('qa', { recursive: true });
  await popup.screenshot({ path: 'qa/anissia-popup.png', fullPage: true });
  await settings.screenshot({ path: 'qa/anissia-settings.png', fullPage: true });
  await writeFile(
    'qa/anissia-report.json',
    JSON.stringify(
      {
        browser: options.channel ?? 'chromium',
        passed: report.length,
        tests: report,
        fixturePermissions: ['https://blog.example/*', 'https://cdn.example/*'],
        scheduleRequests: apiRequests.filter((url) => url.includes('/schedule/')).length,
        captionRequests: apiRequests.filter((url) => url.includes('/caption/')).length,
        fileRequests: fileRequests.length,
        htmlRequests: htmlRequests.length,
      },
      null,
      2,
    ),
  );
} catch (error) {
  console.error(
    JSON.stringify(
      {
        error: error.message,
        status: popup ? await status().catch((e) => ({ error: e.message })) : undefined,
        events: worker ? await worker.evaluate(() => globalThis.testEvents).catch(() => []) : [],
      },
      null,
      2,
    ),
  );
  throw error;
} finally {
  await context.close();
}
