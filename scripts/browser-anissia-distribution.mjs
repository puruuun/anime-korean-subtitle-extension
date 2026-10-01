import { chromium } from 'playwright';
import { mkdtemp, cp, readFile, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';
const temp = await mkdtemp(join(tmpdir(), 'animesub-distribution-'));
const dist = join(temp, 'extension');
await cp(resolve('dist'), dist, { recursive: true });
const originalManifest = JSON.parse(await readFile(join(dist, 'manifest.json'), 'utf8'));
const tests = [],
  requests = [];
const cases = [
  {
    id: 2798,
    title: '옆집 천사님 때문에 어느샌가 인간적으로 타락한 사연 2기',
    nativeTitle: 'お隣の天使様にいつの間にか駄目人間にされていた件',
    year: 2026,
    season: 2,
    cues: 468,
    driveId: '1PlN67A9AdlJ5gZaIWa6ybqAVDG6Bs2Gi',
  },
  {
    id: 3041,
    title: '사일런트 위치 침묵의 마녀의 비밀',
    nativeTitle: 'サイレント・ウィッチ 沈黙の魔女の隠しごと',
    year: 2025,
    season: 1,
    cues: 1667,
    driveId: '1Dm5IbVlS3p-sKNsChNN9cr2v27N7zZuG',
  },
];
for (const permissions of ['none', 'blog', 'all']) {
  const manifest = structuredClone(originalManifest);
  if (permissions !== 'none') manifest.host_permissions.push('https://kairan03.blogspot.com/*');
  if (permissions === 'all')
    manifest.host_permissions.push('https://drive.usercontent.google.com/*');
  await writeFile(join(dist, 'manifest.json'), JSON.stringify(manifest));
  const context = await chromium.launchPersistentContext(join(temp, permissions), {
    channel: 'chromium',
    headless: true,
    ignoreDefaultArgs: ['--disable-extensions'],
    args: ['--disable-extensions-except=' + dist, '--load-extension=' + dist],
  });
  try {
    context.on('request', (request) => {
      if (
        request.url().includes('blogspot.com') ||
        request.url().includes('drive.usercontent.google.com')
      )
        requests.push(request.url());
    });
    const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
    const id = new URL(worker.url()).host;
    const popup = await context.newPage();
    await popup.goto('chrome-extension://' + id + '/popup.html');
    const send = (msg) =>
      popup.evaluate(async (m) => {
        const r = await chrome.runtime.sendMessage(m);
        if (!r.ok) throw Error(r.error);
        return r;
      }, msg);
    const settings = (await send({ type: 'GET_SETTINGS' })).settings;
    await send({ type: 'SAVE_SETTINGS', settings: { ...settings, mode: 'ko' } });
    for (const example of permissions === 'all' ? cases : [cases[0]]) {
      const url = 'https://www.miruro.to/watch/distribution-' + example.id + '?ep=1';
      await context.route(url, (route) =>
        route.fulfill({
          contentType: 'text/html',
          body:
            '<title>Subtitle test</title><h1 class="anime-title">' +
            example.title +
            '</h1><video controls style="width:800px;height:450px"></video>',
        }),
      );
      const site = await context.newPage();
      await site.goto(url);
      await site.waitForSelector('[data-animesub-overlay]');
      const tabId = await worker.evaluate(
        async (url) => (await chrome.tabs.query({})).find((t) => t.url === url).id,
        url,
      );
      await send({ type: 'CANCEL', tabId });
      await send({ type: 'CLEAR_CACHE' });
      const started = await send({
        type: 'RUN',
        tabId,
        mode: 'ko',
        context: {
          site: 'miruro',
          title: example.title,
          nativeTitle: example.nativeTitle,
          year: example.year,
          season: example.season,
          episode: 1,
          pageUrl: url,
        },
      });
      let status;
      const expires = Date.now() + 60000;
      while (Date.now() < expires) {
        status = (await send({ type: 'GET_STATUS', tabId })).status;
        if (status?.jobId === started.status.jobId && !status.busy) break;
        await new Promise((r) => setTimeout(r, 100));
      }
      if (permissions !== 'all') {
        assert.equal(status.stage, 'select', JSON.stringify(status));
        const required =
          permissions === 'none'
            ? 'https://kairan03.blogspot.com/*'
            : 'https://drive.usercontent.google.com/*';
        assert(
          status.results.some(
            (r) => r.author === '카이란' && r.requiredOrigins?.includes(required),
          ),
          JSON.stringify(status),
        );
        tests.push(
          'Built MV3 identifies missing ' +
            required +
            ' permission and retains the Korean candidate',
        );
      } else {
        assert.equal(status.stage, 'done', JSON.stringify(status));
        assert.equal(status.source, 'anissia');
        const rendered = await worker.evaluate(
          async (tabId) => (await chrome.storage.session.get('render:' + tabId))['render:' + tabId],
          tabId,
        );
        assert.equal(rendered.cues.length, example.cues);
        assert(rendered.cues.some((cue) => /[가-힣]/.test(cue.text)));
        assert(
          requests.some(
            (url) =>
              url.includes('/download') && new URL(url).searchParams.get('id') === example.driveId,
          ),
        );
        const first = rendered.cues[0];
        await site.evaluate((time) => {
          const video = document.querySelector('video');
          video.currentTime = time;
          video.dispatchEvent(new Event('timeupdate'));
        }, first.startTime + 0.05);
        const cdp = await context.newCDPSession(site);
        const doc = await cdp.send('DOM.getDocument', { depth: -1, pierce: true });
        const texts = [];
        function visit(n) {
          if (n.nodeValue) texts.push(n.nodeValue);
          for (const child of [...(n.children ?? []), ...(n.shadowRoots ?? [])]) visit(child);
        }
        visit(doc.root);
        assert(
          texts.some((text) => text.includes(first.text.split('\n')[0])),
          'First cue did not render',
        );
        tests.push(
          'Anissia ' +
            example.id +
            ' episode one: real distribution/download/parse and first cue rendered (' +
            example.cues +
            ' cues)',
        );
      }
      await site.close();
    }
  } finally {
    await context.close();
  }
}
const report = {
  checkedAt: new Date().toISOString(),
  passed: tests.length,
  tests,
  requests,
  scope:
    'Built MV3 extension, real Anissia/Blogspot/feed/Drive requests; controlled video and explicit anime context; host permissions granted in temporary test manifests only; actual external playback/sync not tested',
};
await mkdir('qa', { recursive: true });
await writeFile('qa/anissia-distribution-browser-report.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
