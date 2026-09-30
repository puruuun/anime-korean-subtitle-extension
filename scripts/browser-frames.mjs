import { chromium } from 'playwright';
import { mkdtemp, writeFile, mkdir, cp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';
const profile = await mkdtemp(join(tmpdir(), 'animesub-frame-'));
const dist = await mkdtemp(join(tmpdir(), 'animesub-fixture-extension-'));
await cp(resolve('dist'), dist, { recursive: true });
const manifest = JSON.parse(await readFile(join(dist, 'manifest.json'), 'utf8'));
manifest.host_permissions.push('https://player.example/*');
await writeFile(join(dist, 'manifest.json'), JSON.stringify(manifest));
const context = await chromium.launchPersistentContext(profile, {
  channel: process.platform === 'win32' ? 'msedge' : undefined,
  headless: true,
  ignoreDefaultArgs: ['--disable-extensions'],
  args: ['--disable-extensions-except=' + dist, '--load-extension=' + dist],
});
const report = [];
try {
  const top =
    '<!doctype html><html><head><title>Test Show - Episode 1 | Re:ANIME</title><script type="application/ld+json">{"@type":"TVEpisode","episodeNumber":"1","partOfSeries":{"name":"Test Show"}}</script></head><body><iframe id="video-player" allow="fullscreen" src="https://player.example/embed"></iframe></body></html>';
  const frame =
    '<!doctype html><html><head><meta charset=utf-8></head><body><div id="player"><video style="width:600px;height:340px"></video><button id="full" onclick="document.getElementById(\'player\').requestFullscreen()">전체화면</button></div></body></html>';
  await context.route('https://reanime.to/**', (r) =>
    r.fulfill({ contentType: 'text/html', body: top }),
  );
  await context.route('https://player.example/**', (r) =>
    r.fulfill({ contentType: 'text/html', body: frame }),
  );
  const site = await context.newPage();
  await site.goto('https://reanime.to/watch/test?ep=1');
  const worker =
    context.serviceWorkers()[0] ??
    (await context.waitForEvent('serviceworker', { timeout: 15000 }));
  const id = new URL(worker.url()).host;
  const tabId = await worker.evaluate(
    async () => (await chrome.tabs.query({})).find((t) => t.url?.includes('reanime.to/watch'))?.id,
  );
  assert(tabId);
  // The isolated fixture pregrants the player origin to avoid a native permission dialog in headless mode.
  const opened = context.waitForEvent('page');
  await worker.evaluate(
    async (url) => chrome.tabs.create({ url, active: false }),
    'chrome-extension://' + id + '/popup.html',
  );
  const popup = await opened;
  await popup.getByRole('button', { name: '플레이어·자막 접근 허용' }).waitFor();
  await popup.getByRole('button', { name: '플레이어·자막 접근 허용' }).click();
  const embedded = site.frames().find((f) => f.url().includes('player.example'));
  assert(embedded);
  try {
    await embedded.waitForSelector('[data-animesub-overlay]', { timeout: 10000 });
  } catch (e) {
    console.log(await popup.locator('main').innerText());
    console.log(await worker.evaluate(() => chrome.permissions.getAll()));
    console.log(
      await embedded.evaluate(() => ({
        bridge: window.__animeSubBridgeV1,
        content: window.__animeSubIsolatedV1,
        video: !!document.querySelector('video'),
      })),
    );
    throw e;
  }
  report.push('ReANIME cross-origin iframe injected with pregranted test-origin permission');
  const frames = await worker.evaluate(
    async (tabId) => chrome.webNavigation.getAllFrames({ tabId }),
    tabId,
  );
  const f = frames.find((f) => f.url.includes('player.example'));
  await worker.evaluate(
    async ({ tabId, frameId }) =>
      chrome.tabs.sendMessage(
        tabId,
        {
          type: 'APPLY',
          epoch: 10,
          offset: 0,
          display: { fontSize: 28, bottom: 8, backgroundOpacity: 0.55, outline: 2, maxLines: 3 },
          cues: [{ id: 1, startTime: 1, endTime: 3, text: '한국어 테스트' }],
        },
        { frameId },
      ),
    { tabId, frameId: f.frameId },
  );
  await embedded.evaluate(() => {
    const v = document.querySelector('video');
    v.currentTime = 2;
    v.dispatchEvent(new Event('seeked'));
  });
  const overlay = embedded.locator('[data-animesub-overlay]');
  assert(await overlay.count());
  report.push('Worker routes Korean cues to actual video frame');
  await embedded.locator('#full').click();
  await embedded.waitForFunction(
    () =>
      document.fullscreenElement?.id === 'player' &&
      document.querySelector('[data-animesub-overlay]').parentElement.id === 'player',
    {},
    { timeout: 5000 },
  );
  report.push('Container fullscreen keeps overlay inside fullscreen subtree');
  await embedded.evaluate(() => document.exitFullscreen());
  await worker.evaluate(
    async ({ tabId, frameId }) =>
      chrome.tabs.sendMessage(tabId, { type: 'CLEAR', epoch: 11 }, { frameId }),
    { tabId, frameId: f.frameId },
  );
  const stale = await worker.evaluate(
    async ({ tabId, frameId }) =>
      chrome.tabs.sendMessage(tabId, { type: 'APPLY', epoch: 10, cues: [] }, { frameId }),
    { tabId, frameId: f.frameId },
  );
  assert.equal(stale.ok, false);
  report.push('Old episode APPLY rejected after newer CLEAR epoch');
  const secretAccess = await worker.evaluate(async (tabId) => {
    const results = await chrome.scripting.executeScript({
      target: { tabId, frameIds: [0] },
      world: 'ISOLATED',
      func: async () => {
        try {
          return { ok: true, data: await chrome.storage.local.get('settings') };
        } catch {
          return { ok: false };
        }
      },
    });
    return results[0].result;
  }, tabId);
  assert.equal(secretAccess.ok, false);
  report.push('ISOLATED content script denied credential storage access');
  await mkdir('qa', { recursive: true });
  await writeFile('qa/frame-report.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally {
  await context.close();
}
