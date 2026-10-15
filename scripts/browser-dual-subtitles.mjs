import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';
const profile = process.env.ANIMESUB_TEST_PROFILE ?? 'personal';
const dist = resolve(process.env.ANIMESUB_TEST_DIST ?? 'dist');
const tests = [],
  counts = { ko: 0, ja: 0, jpFiles: 0, koFiles: 0, llm: 0, aborted: 0 };
let phase = 'ko',
  holdJapanese = false,
  holdTranslation = false;
const pendingJapanese = [],
  pendingTranslation = [];
const server = createServer(async (req, res) => {
  let body = '';
  for await (const c of req) body += c;
  const payload = JSON.parse(JSON.parse(body).messages.at(-1).content);
  counts.llm++;
  const finish = () => {
    if (!res.destroyed)
      res.end(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  translations: payload.toTranslate.map((c) => ({
                    id: c.id,
                    text: '한국어 번역 ' + c.id,
                  })),
                }),
              },
              finish_reason: 'stop',
            },
          ],
        }),
      );
  };
  if (holdTranslation && payload.toTranslate[0].id > 20) pendingTranslation.push(finish);
  else finish();
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
const browser = await chromium.launchPersistentContext(
  join(await mkdtemp(join(tmpdir(), 'animesub-dual-')), 'profile'),
  {
    channel: 'chromium',
    headless: true,
    ignoreDefaultArgs: ['--disable-extensions'],
    args: ['--disable-extensions-except=' + dist, '--load-extension=' + dist],
    viewport: { width: 1280, height: 900 },
  },
);
const srt = (language, ep) =>
  Array.from(
    { length: 40 },
    (_, i) =>
      `${i + 1}\n00:${String(Math.floor((i * 5) / 60)).padStart(2, '0')}:${String((i * 5) % 60).padStart(2, '0')},000 --> 00:${String(Math.floor((i * 5 + 4) / 60)).padStart(2, '0')}:${String((i * 5 + 4) % 60).padStart(2, '0')},000\n${language} EP${ep} cue${i + 1}`,
  ).join('\n\n');
async function eventually(fn, label, timeout = 15000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const result = await fn();
    if (result) return result;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw Error(label + ' timed out');
}
try {
  await browser.route('https://api.github.com/**', (r) => r.fulfill({ status: 404, json: {} }));
  await browser.route('https://graphql.anilist.co/**', (r) => r.fulfill({ json: { data: null } }));
  await browser.route('https://api.anissia.net/**', (r) => {
    counts.ko++;
    return r.fulfill({
      json: {
        code: 'ok',
        data: r.request().url().includes('/schedule/')
          ? [
              {
                animeNo: 42,
                subject: 'Test Show',
                originalSubject: 'テスト',
                startDate: '',
                endDate: '',
              },
            ]
          : phase === 'translate'
            ? []
            : [
                {
                  episode: '3',
                  name: 'Author',
                  updDt: phase,
                  website: 'https://test-subtitles.blogspot.com/dual-' + phase,
                },
              ],
      },
    });
  });
  await browser.route('https://test-subtitles.blogspot.com/**', (r) => {
    const url = r.request().url();
    if (url.endsWith('.srt')) {
      counts.koFiles++;
      return r.fulfill({
        contentType: 'text/plain',
        body: srt('한국어', Number(url.match(/E(\d+)/)[1])),
      });
    }
    return r.fulfill({
      contentType: 'text/html',
      body: [1, 2, 3]
        .map(
          (ep) => `<a href="https://test-subtitles.blogspot.com/${phase}.E${ep}.srt">${ep}화</a>`,
        )
        .join(''),
    });
  });
  await browser.route('https://jimaku.cc/api/**', (r) => {
    counts.ja++;
    return r.fulfill({
      json:
        phase === 'missing'
          ? []
          : r.request().url().includes('/search?')
            ? [{ id: 9, name: 'Test Show', japanese_name: 'テスト' }]
            : [1, 2, 3].map((ep) => ({
                name: 'Test Show E' + ep + '.srt',
                url: 'https://jimaku.cc/subtitle/' + phase + '/E' + ep + '.srt',
                size: 4000,
                last_modified: phase,
              })),
    });
  });
  await browser.route('https://jimaku.cc/subtitle/**', async (r) => {
    counts.jpFiles++;
    const ep = Number(
      r
        .request()
        .url()
        .match(/E(\d+)/)[1],
    );
    const finish = () =>
      r.fulfill({ contentType: 'text/plain', body: srt('日本語', ep) }).catch(() => {
        counts.aborted++;
      });
    if (holdJapanese)
      await new Promise((resolve) =>
        pendingJapanese.push(async () => {
          await finish();
          resolve();
        }),
      );
    else await finish();
  });
  await browser.route('https://subtitles.ajatt.top/**', (r) =>
    r.fulfill({ contentType: 'text/html', body: '<p>No Japanese files</p>' }),
  );
  const player =
    '<html><meta charset="utf-8"><body style="margin:0;background:#101624"><div id="player"><video controls style="width:960px;height:540px;background:#17273a"></video><button id="full" onclick="document.getElementById(\'player\').requestFullscreen()">전체화면</button></div></body></html>';
  await browser.route('https://www.miruro.to/watch/**', (r) =>
    r.fulfill({
      contentType: 'text/html',
      body:
        '<meta charset="utf-8"><title>Watch Test Show</title><h1 class="anime-title">Test Show</h1>' +
        player,
    }),
  );
  await browser.route('https://flixcloud.cc/e/dual**', (r) =>
    r.fulfill({ contentType: 'text/html', body: player }),
  );
  await browser.route('https://reanime.to/watch/**', (r) =>
    r.fulfill({
      contentType: 'text/html',
      body: '<meta charset="utf-8"><title>Test Show - Episode 1 | Re:ANIME</title><script type="application/ld+json">{"@type":"TVEpisode","episodeNumber":1,"partOfSeries":{"name":"Test Show"}}</script><iframe id="video-player" allow="fullscreen" style="width:1000px;height:600px" src="https://flixcloud.cc/e/dual"></iframe>',
    }),
  );
  const worker = browser.serviceWorkers()[0] ?? (await browser.waitForEvent('serviceworker'));
  const id = new URL(worker.url()).host;
  await eventually(
    () => browser.pages().some((p) => p.url() === 'chrome-extension://' + id + '/settings.html'),
    'initial installation finished',
  );
  await worker.evaluate(() => {
    globalThis.permissionRequests = 0;
    chrome.permissions.request = async () => {
      globalThis.permissionRequests++;
      throw Error('Unexpected permission request');
    };
  });
  const ui = await browser.newPage();
  await ui.goto('chrome-extension://' + id + '/popup.html');
  const send = (m) =>
    ui.evaluate(async (m) => {
      const r = await chrome.runtime.sendMessage(m);
      if (!r?.ok) throw Error(r?.error);
      return r;
    }, m);
  const settings = (await send({ type: 'GET_SETTINGS' })).settings;
  assert.equal(settings.display.showJapanese, false);
  await send({
    type: 'SAVE_SETTINGS',
    settings: {
      ...settings,
      jimaku: { apiKey: 'browser-fixture-key' },
      translation: {
        ...settings.translation,
        model: 'dual-model',
        baseUrl: 'http://127.0.0.1:' + port + '/v1',
        maxRetry: 0,
      },
      display: { ...settings.display, showJapanese: true },
    },
  });
  tests.push('Japanese is opt-in and settings preserve AUTO defaults');
  assert.equal((await send({ type: 'GET_SETTINGS' })).settings.display.showJapanese, true);
  const site = await browser.newPage();
  holdJapanese = true;
  await site.goto('https://www.miruro.to/watch/dual-ko/show?ep=1');
  let tabId = await worker.evaluate(
    async () => (await chrome.tabs.query({})).find((t) => t.url?.includes('/watch/dual-ko/')).id,
  );
  const status = async () => (await send({ type: 'GET_STATUS', tabId })).status;
  const snapshot = async () =>
    worker.evaluate(
      async (id) => (await chrome.storage.session.get('render:' + id))['render:' + id],
      tabId,
    );
  async function navigate(ep, anime = 'dual-ko') {
    await site.evaluate(
      ({ ep, anime }) => history.pushState({}, '', '/watch/' + anime + '/show?ep=' + ep),
      { ep, anime },
    );
  }
  await eventually(async () => {
    const s = await status();
    return s?.stage === 'done' && s.japanese?.state === 'searching';
  }, 'Korean completes before Japanese');
  assert((await snapshot()).cues.length);
  assert.equal((await status()).finishedAt, undefined);
  tests.push(
    'Korean applies immediately while Japanese is pending; clock continues until extra work ends',
  );
  holdJapanese = false;
  for (const finish of pendingJapanese.splice(0)) await finish();
  await eventually(async () => (await status())?.japanese?.state === 'ready', 'Japanese ready');
  const completed = await status();
  assert(completed.finishedAt);
  assert.equal(counts.llm, 0);
  assert.equal(counts.jpFiles, 1);
  tests.push('One Japanese download joins Korean with no LLM calls and stops the job clock');
  async function at(frame, time) {
    await frame.evaluate((t) => {
      const v = document.querySelector('video');
      v.currentTime = t;
      v.dispatchEvent(new Event('seeked'));
    }, time);
  }
  async function rendered(frame) {
    const cdp = await browser.newCDPSession(frame);
    try {
      const { root } = await cdp.send('DOM.getDocument', { depth: -1, pierce: true });
      const found = {};
      function scan(node) {
        const attributes = node.attributes ?? [];
        const i = attributes.indexOf('class');
        if (i >= 0 && ['primary-subtitle', 'japanese-subtitle'].includes(attributes[i + 1])) {
          found[attributes[i + 1]] = node;
        }
        for (const child of [
          ...(node.children ?? []),
          ...(node.shadowRoots ?? []),
          ...(node.contentDocument ? [node.contentDocument] : []),
        ])
          scan(child);
      }
      scan(root);
      let result = {};
      for (const [name, node] of Object.entries(found)) {
        result[name] = (
          await cdp.send('DOM.getOuterHTML', { backendNodeId: node.backendNodeId })
        ).outerHTML;
      }
      return result;
    } finally {
      await cdp.detach();
    }
  }
  await at(site, 2);
  let lines = await rendered(site);
  assert(lines['primary-subtitle'].includes('한국어 EP1'));
  assert(lines['japanese-subtitle'].includes('日本語 EP1'));
  tests.push(
    'Closed-shadow renderer visibly contains Korean above real Japanese at matching timestamps',
  );
  const beforeToggle = { ...counts },
    jobId = completed.jobId;
  await worker.evaluate(async (id) => chrome.tabs.update(id, { active: true }), tabId);
  const open = browser.waitForEvent('page');
  await worker.evaluate(
    (url) => chrome.tabs.create({ url, active: false }),
    'chrome-extension://' + id + '/popup.html',
  );
  const popup = await open;
  const toggle = popup.getByRole('checkbox', { name: '일본어 원문 함께 보기' });
  await toggle.uncheck();
  await eventually(async () => (await status())?.japanese?.state === 'off', 'extra off');
  lines = await rendered(site);
  assert(!lines['japanese-subtitle'].includes('日本語'));
  assert(lines['primary-subtitle'].includes('한국어'));
  await toggle.check();
  await eventually(async () => (await status())?.japanese?.state === 'ready', 'extra on');
  assert.equal((await status()).jobId, jobId);
  assert.deepEqual(counts, beforeToggle);
  tests.push(
    'Popup switch changes only Japanese, retaining Korean/job identity with no extra download/search/translation',
  );
  const clock = await popup.locator('[data-work-elapsed]').innerText();
  await at(site, 12);
  await new Promise((r) => setTimeout(r, 2200));
  assert.equal(await popup.locator('[data-work-elapsed]').innerText(), clock);
  assert.equal((await status()).finishedAt, completed.finishedAt);
  tests.push('Elapsed time stays frozen through popup polling and playback seeks after completion');
  const settingsPage = await browser.newPage();
  await settingsPage.goto('chrome-extension://' + id + '/settings.html');
  await eventually(
    () => settingsPage.getByRole('checkbox', { name: '일본어 원문 함께 보기' }).isChecked(),
    'loaded display preferences',
  );
  await settingsPage.getByLabel('일본어 글자 크기 (px)', { exact: true }).fill('19');
  await settingsPage.getByLabel('일본어 추가 싱크 (초)', { exact: true }).fill('-2');
  await settingsPage.getByRole('button', { name: '설정 저장', exact: true }).click();
  await settingsPage.getByText('설정이 저장되었습니다.', { exact: true }).waitFor();
  await mkdir('qa', { recursive: true });
  await settingsPage
    .getByRole('heading', { name: '추가 자막', exact: true })
    .scrollIntoViewIfNeeded();
  await settingsPage.screenshot({ path: 'qa/dual-settings-' + profile + '.png' });
  await settingsPage.close();
  await at(site, 5);
  lines = await rendered(site);
  assert(lines['japanese-subtitle'].includes('日本語 EP1 cue1'));
  assert(!lines['primary-subtitle'].includes('cue1'));
  assert(lines['japanese-subtitle'].includes('19px'));
  tests.push(
    'Settings immediately change Japanese font and independent timing without restarting Korean',
  );
  await at(site, 2);
  await site.locator('#full').click();
  await eventually(
    () => site.evaluate(() => document.fullscreenElement?.id === 'player'),
    'container fullscreen',
  );
  lines = await rendered(site);
  assert(lines['primary-subtitle'].includes('한국어'));
  assert(lines['japanese-subtitle'].includes('日本語'));
  await site.evaluate(() => document.exitFullscreen());
  tests.push('Container fullscreen retains both subtitle lines');
  const native = await worker.evaluate(async (tabId) => {
    const results = await chrome.scripting.executeScript({
      target: { tabId, frameIds: [0] },
      world: 'ISOLATED',
      func: () => {
        Object.defineProperty(document, 'fullscreenElement', {
          value: document.querySelector('video'),
          configurable: true,
        });
        document.dispatchEvent(new Event('fullscreenchange'));
        const result = Array.from(document.querySelector('video').textTracks)
          .filter((t) => t.label === '한국어 · AnimeSub')
          .flatMap((t) => Array.from(t.cues ?? []).map((c) => c.text));
        delete document.fullscreenElement;
        document.dispatchEvent(new Event('fullscreenchange'));
        return result;
      },
    });
    return results[0].result;
  }, tabId);
  assert(native.some((text) => text.includes('한국어') && text.includes('日本語')));
  tests.push('Video-element fullscreen fallback combines both languages in a native cue');
  await mkdir('qa', { recursive: true });
  await site.screenshot({ path: 'qa/dual-subtitles-' + profile + '.png' });
  await popup.screenshot({ path: 'qa/dual-popup-' + profile + '.png' });
  await popup.close();
  const beforeCache = { ...counts };
  await navigate(2);
  await eventually(
    async () =>
      (await status())?.context.episode === 2 && (await status()).japanese?.state === 'ready',
    'EP2',
  );
  await navigate(1);
  await eventually(
    async () =>
      (await status())?.context.episode === 1 &&
      (await status()).cached &&
      (await status()).japanese?.state === 'ready',
    'dual cached EP1',
  );
  assert.equal(counts.jpFiles, beforeCache.jpFiles + 1);
  assert.equal(counts.koFiles, beforeCache.koFiles + 1);
  tests.push(
    'Episode revisit restores Korean plus Japanese from cache without another file download',
  );
  phase = 'translate';
  holdTranslation = true;
  await navigate(1, 'dual-ja');
  await eventually(
    async () =>
      (await status())?.context.pageUrl.includes('dual-ja') &&
      (await snapshot())?.cues.length === 20 &&
      (await status()).busy,
    'first translated chunk',
  );
  assert((await snapshot()).japaneseCues.length === 40);
  const jaFiles = counts.jpFiles;
  await at(site, 2);
  lines = await rendered(site);
  assert(lines['primary-subtitle'].includes('한국어 번역'));
  assert(lines['japanese-subtitle'].includes('日本語'));
  tests.push(
    'Progressive Japanese translation shows first Korean chunk plus original Japanese before full completion',
  );
  holdTranslation = false;
  for (const finish of pendingTranslation.splice(0)) finish();
  await eventually(async () => (await status())?.stage === 'done', 'translation done');
  assert.equal(counts.jpFiles, jaFiles);
  tests.push(
    'Japanese translation originals are reused without a duplicate search or file request',
  );
  phase = 'missing';
  await navigate(1, 'dual-missing');
  await eventually(
    async () =>
      (await status())?.context.pageUrl.includes('dual-missing') &&
      (await status()).japanese?.state === 'unavailable',
    'missing Japanese',
  );
  assert.equal((await status()).stage, 'done');
  assert((await status()).finishedAt);
  assert((await snapshot()).cues.length);
  tests.push(
    'Missing Japanese leaves Korean applied and ends the clock with an explicit unavailable message',
  );
  phase = 'cancel';
  holdJapanese = true;
  await navigate(1, 'dual-cancel');
  await eventually(
    async () =>
      (await status())?.context.pageUrl.includes('dual-cancel') && pendingJapanese.length > 0,
    'pending old Japanese',
  );
  await navigate(2, 'dual-cancel');
  await eventually(
    async () => (await status())?.context.episode === 2 && pendingJapanese.length > 1,
    'pending new Japanese',
  );
  holdJapanese = false;
  for (const finish of pendingJapanese.splice(0)) await finish();
  await eventually(
    async () =>
      (await status())?.context.episode === 2 && (await status()).japanese?.state === 'ready',
    'new Japanese',
  );
  assert((await snapshot()).japaneseCues.every((c) => c.text.includes('EP2')));
  tests.push(
    'Fast episode changes abort and reject previous Japanese results; only current episode remains',
  );
  phase = 'iframe';
  await site.goto('https://reanime.to/watch/dual-iframe?ep=1');
  await eventually(
    async () =>
      (await status())?.context.site === 'reanime' && (await status()).japanese?.state === 'ready',
    'Reanime dual',
  );
  const frame = site.frames().find((f) => f.url().includes('flixcloud.cc'));
  await at(frame, 2);
  lines = await rendered(frame);
  assert(lines['primary-subtitle'].includes('한국어'));
  assert(lines['japanese-subtitle'].includes('日本語'));
  tests.push('Re:ANIME cross-origin player iframe receives both Korean and Japanese');
  const beforePlayer = { ...counts };
  await site.evaluate(() => (document.querySelector('iframe').src += '?replacement=1'));
  const replacement = await eventually(
    () => site.frames().find((f) => f.url().includes('replacement=1')),
    'replacement iframe',
  );
  await eventually(() => replacement.locator('[data-animesub-overlay]').count(), 'new renderer');
  await at(replacement, 2);
  lines = await rendered(replacement);
  assert(lines['japanese-subtitle'].includes('日本語'));
  assert.deepEqual(counts, beforePlayer);
  tests.push('Replacing iframe restores both tracks with no repeated provider or translation work');
  assert.equal(await worker.evaluate(() => globalThis.permissionRequests), 0);
  tests.push('All dual subtitle and clock scenarios make zero runtime permission requests');
  const report = {
    date: new Date().toISOString(),
    profile,
    version: await worker.evaluate(() => chrome.runtime.getManifest().version),
    passed: tests,
    count: tests.length,
    counts,
    permissionRequests: 0,
    boundaries:
      'Isolated Chromium MV3, simulated service/site/player/LLM responses, real routing/cache/renderer/CDP closed-shadow inspection. Native video fullscreen branch is simulated; container fullscreen is real. User Chrome untouched.',
  };
  await writeFile('qa/dual-subtitles-' + profile + '-report.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} catch (e) {
  const debugWorker = browser.serviceWorkers()[0];
  const debug = debugWorker
    ? await debugWorker
        .evaluate(async () => {
          const { settings } = await chrome.storage.local.get('settings');
          const session = await chrome.storage.session.get(null);
          return {
            showJapanese: settings?.display?.showJapanese,
            jimakuConfigured: !!settings?.jimaku?.apiKey,
            jobs: Object.entries(session)
              .filter(([k]) => k.startsWith('job:'))
              .map(([k, s]) => ({ key: k, stage: s.stage, busy: s.busy, japanese: s.japanese })),
          };
        })
        .catch(() => null)
    : null;
  console.error(JSON.stringify({ error: e.message, passed: tests, counts }, null, 2));
  console.error(JSON.stringify({ debug }, null, 2));
  throw e;
} finally {
  holdJapanese = false;
  holdTranslation = false;
  for (const finish of pendingJapanese.splice(0)) await finish();
  for (const finish of pendingTranslation.splice(0)) finish();
  await browser.close();
  await new Promise((r) => server.close(r));
}
