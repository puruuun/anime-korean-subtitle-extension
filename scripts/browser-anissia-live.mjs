import { chromium } from 'playwright';
import { mkdtemp, cp, readFile, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';
const temp = await mkdtemp(join(tmpdir(), 'animesub-anissia-live-'));
const dist = join(temp, 'extension');
await cp(resolve('dist'), dist, { recursive: true });
const baseManifest = JSON.parse(await readFile(join(dist, 'manifest.json'), 'utf8'));
const publicManifest = JSON.parse(await readFile(resolve('manifest.json'), 'utf8'));
const url =
  'https://www.miruro.to/watch/qFe2jyMO-z1LwHyLlLpGyRUbWSg0g55W/seihantai-na-kimi-to-boku-2nd-season?ep=12';
const results = [];
for (const permitted of [false, true]) {
  const manifest = structuredClone(permitted ? baseManifest : publicManifest);
  if (!permitted)
    manifest.host_permissions = manifest.host_permissions.filter(
      (origin) => !/tistory|kakaocdn|blogspot|drive\./.test(origin),
    );
  await writeFile(join(dist, 'manifest.json'), JSON.stringify(manifest));
  const context = await chromium.launchPersistentContext(
    join(temp, permitted ? 'allowed' : 'denied'),
    {
      channel: 'chromium',
      headless: true,
      ignoreDefaultArgs: ['--disable-extensions'],
      args: ['--disable-extensions-except=' + dist, '--load-extension=' + dist],
    },
  );
  try {
    const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
    const id = worker.url().split('/')[2];
    const popup = await context.newPage();
    await popup.goto('chrome-extension://' + id + '/popup.html');
    const send = (msg) =>
      popup.evaluate(async (m) => {
        const r = await chrome.runtime.sendMessage(m);
        if (!r.ok) throw Error(r.error);
        return r;
      }, msg);
    const settings = (await send({ type: 'GET_SETTINGS' })).settings;
    await send({
      type: 'SAVE_SETTINGS',
      settings: { ...settings, mode: permitted ? 'auto' : 'ko' },
    });
    await context.route(url, (route) =>
      route.fulfill({
        contentType: 'text/html',
        body: '<title>Watch You and I Are Polar Opposites Season 2 · Miruro</title><h1 class="anime-title">You and I Are Polar Opposites Season 2</h1><video controls style="width:800px;height:450px"></video>',
      }),
    );
    const site = await context.newPage();
    await site.goto(url);
    await site.waitForSelector('[data-animesub-overlay]');
    const tabId = await worker.evaluate(
      async (url) => (await chrome.tabs.query({})).find((tab) => tab.url === url).id,
      url,
    );
    const started = permitted ? undefined : await send({ type: 'RUN', tabId, mode: 'ko' });
    let status;
    const expires = Date.now() + 60000;
    while (Date.now() < expires) {
      status = (await send({ type: 'GET_STATUS', tabId })).status;
      if (
        status &&
        !status.busy &&
        (permitted ? status.stage === 'done' : status.jobId === started.status.jobId)
      )
        break;
      await new Promise((r) => setTimeout(r, 100));
    }
    if (!permitted) {
      assert.equal(status.stage, 'select', JSON.stringify(status));
      assert(
        status.results.some((r) => r.requiredOrigins?.includes('https://sumomomo.tistory.com/*')),
      );
      results.push(
        'Real API search shows the exact missing Tistory permission instead of NOT_FOUND',
      );
    } else {
      assert.equal(status.stage, 'done', JSON.stringify(status));
      assert.equal(status.source, 'anissia');
      assert.equal(status.context.episodeOffset, 12);
      const rendered = await worker.evaluate(
        async (tabId) => (await chrome.storage.session.get('render:' + tabId))['render:' + tabId],
        tabId,
      );
      assert.equal(rendered.cues.length, 425);
      const first = rendered.cues[0];
      await site.evaluate((time) => {
        const v = document.querySelector('video');
        v.currentTime = time;
        v.dispatchEvent(new Event('timeupdate'));
      }, first.startTime + 0.05);
      await site.waitForTimeout(200);
      const cdp = await context.newCDPSession(site);
      const doc = await cdp.send('DOM.getDocument', { depth: -1, pierce: true });
      const texts = [];
      function visit(n) {
        if (n.nodeValue) texts.push(n.nodeValue);
        for (const child of [...(n.children ?? []), ...(n.shadowRoots ?? [])]) visit(child);
      }
      visit(doc.root);
      assert(
        texts.some((t) => t.includes(first.text.split('\n')[0])),
        'First Korean cue did not render',
      );
      results.push(
        'AUTO runs without a Start button and real AniList + Anissia + Tistory + CDN requests deliver 425 Korean cues',
      );
      results.push(
        'Season 2 episode 12 accepts verified cumulative episode 24 and renders its first Korean cue',
      );
    }
  } finally {
    await context.close();
  }
}
await mkdir('qa', { recursive: true });
const report = {
  checkedAt: new Date().toISOString(),
  passed: results.length,
  tests: results,
  scope:
    'Built MV3 with controlled video and real API/page/ZIP requests; positive manifest profile: ' +
    (baseManifest.host_permissions.includes('<all_urls>') ? 'personal' : 'public') +
    '; negative manifest removes required resolver hosts; actual external video playback not tested',
};
await writeFile('qa/anissia-browser-live-report.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
