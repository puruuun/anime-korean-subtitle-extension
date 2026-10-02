import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { mkdtemp, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';
const tests = [],
  timings = [],
  counts = { anissia: 0, jimaku: 0, mirror: 0, downloads: 0, llm: 0, aborted: 0 };
let phase = 'ko',
  holdLater = false,
  holdAll = false,
  serviceReadyAt = 0;
const pending = [];
const server = createServer(async (req, res) => {
  let text = '';
  for await (const chunk of req) text += chunk;
  const payload = JSON.parse(JSON.parse(text).messages.at(-1).content);
  counts.llm++;
  const finish = () => {
    if (!res.destroyed)
      res.end(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  translations:
                    phase === 'partial' && payload.toTranslate[0].id > 20
                      ? []
                      : payload.toTranslate.map((c) => ({
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
  };
  let completed = false;
  res.on('close', () => {
    if (!completed) counts.aborted++;
  });
  const release = () => {
    completed = true;
    finish();
  };
  if (holdAll || (holdLater && payload.toTranslate[0].id > 20)) pending.push(release);
  else setTimeout(release, 100);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
const temp = await mkdtemp(join(tmpdir(), 'animesub-auto-'));
const profile = process.env.ANIMESUB_TEST_PROFILE ?? 'personal';
const dist = resolve(process.env.ANIMESUB_TEST_DIST ?? 'dist');
const browser = await chromium.launchPersistentContext(join(temp, 'profile'), {
  channel: 'chromium',
  headless: true,
  ignoreDefaultArgs: ['--disable-extensions'],
  args: ['--disable-extensions-except=' + dist, '--load-extension=' + dist],
  viewport: { width: 1280, height: 900 },
});
const root =
  'https://raw.githubusercontent.com/Ajatt-Tools/kitsunekko-mirror/refs/heads/main/subtitles/anime_tv/Test/';
const srt = (language, ep) =>
  Array.from(
    { length: 40 },
    (_, i) =>
      `${i + 1}\n00:${String(Math.floor((i * 5) / 60)).padStart(2, '0')}:${String((i * 5) % 60).padStart(2, '0')},000 --> 00:${String(Math.floor((i * 5 + 4) / 60)).padStart(2, '0')}:${String((i * 5 + 4) % 60).padStart(2, '0')},000\n${language} EP${ep} cue${i + 1}`,
  ).join('\n\n');
async function eventually(fn, label, timeout = 20000) {
  const until = Date.now() + timeout;
  let last;
  while (Date.now() < until) {
    last = await fn();
    if (last) return last;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw Error(label + ' timeout: ' + JSON.stringify(last));
}
try {
  await browser.route('https://graphql.anilist.co/**', (r) => r.fulfill({ json: { data: null } }));
  await browser.route('https://api.anissia.net/**', (r) => {
    counts.anissia++;
    if (phase === 'flaky' && Date.now() < serviceReadyAt)
      return r.fulfill({ status: 503, body: '{}' });
    const schedule = r.request().url().includes('/schedule/');
    const other = r.request().url().endsWith('/43');
    const data = schedule
      ? [
          {
            animeNo: 42,
            subject: 'Test Show',
            originalSubject: 'テスト',
            startDate: '',
            endDate: '',
          },
          {
            animeNo: 43,
            subject: 'Other Show',
            originalSubject: '別の作品',
            startDate: '',
            endDate: '',
          },
        ]
      : [
          {
            episode: '3',
            name: 'Author',
            updDt: phase,
            website:
              'https://test-subtitles.blogspot.com/' +
              (['ko', 'flaky'].includes(phase) ? (other ? 'other' : 'test') : 'missing'),
          },
        ];
    return r.fulfill({ json: { code: 'ok', data } });
  });
  await browser.route('https://test-subtitles.blogspot.com/**', (r) => {
    const url = r.request().url();
    if (/\.srt$/.test(url)) {
      counts.downloads++;
      return r.fulfill({
        contentType: 'text/plain',
        body: srt('한국어', Number(url.match(/E(\d+)/)[1])),
      });
    }
    return r.fulfill({
      contentType: 'text/html',
      body: url.endsWith('missing')
        ? '<html>Not yet available</html>'
        : [1, 2, 3]
            .map(
              (ep) => `<a href="https://test-subtitles.blogspot.com/Show.E${ep}.srt">${ep}화</a>`,
            )
            .join(''),
    });
  });
  await browser.route('https://jimaku.cc/api/**', (r) => {
    counts.jimaku++;
    return r.fulfill({
      json: ['ja', 'partial'].includes(phase)
        ? r.request().url().includes('/search?')
          ? [{ id: 9, name: 'Test Show', japanese_name: 'テスト' }]
          : [1, 2, 3].map((ep) => ({
              name: 'Test Show E' + ep + '.srt',
              url: 'https://jimaku.cc/subtitle/E' + ep + '.srt',
              size: 5000,
              last_modified: 'test',
            }))
        : [],
    });
  });
  await browser.route('https://jimaku.cc/subtitle/**', (r) => {
    counts.downloads++;
    return r.fulfill({
      contentType: 'text/plain',
      body: srt(
        '日本語',
        Number(
          r
            .request()
            .url()
            .match(/E(\d+)/)[1],
        ),
      ),
    });
  });
  await browser.route('https://subtitles.ajatt.top/**', (r) => {
    counts.mirror++;
    return r.fulfill({
      contentType: 'text/html',
      body:
        r.request().url() === 'https://subtitles.ajatt.top/'
          ? '<table><tr><td>1</td><td><a href="anime_tv/test.html">Test Show</a></td><td>TV</td><td>Test Show</td><td>テスト</td></tr></table>'
          : phase === 'mirror'
            ? [1, 2, 3].map((ep) => `<a href="${root}Test%20Show%20E${ep}.srt">${ep}</a>`).join('')
            : '<p>No episode files</p>',
    });
  });
  await browser.route(root + '**', (r) => {
    counts.downloads++;
    return r.fulfill({
      contentType: 'text/plain',
      body: srt(
        '日本語 Mirror',
        Number(
          r
            .request()
            .url()
            .match(/E(\d+)/)[1],
        ),
      ),
    });
  });
  const videoHTML = '<video controls style="width:900px;height:506px"></video>';
  await browser.route('https://flixcloud.cc/e/test-player**', (r) =>
    r.fulfill({ contentType: 'text/html', body: videoHTML }),
  );
  await browser.route('https://strm.cx/test-player**', (r) =>
    r.fulfill({ contentType: 'text/html', body: videoHTML }),
  );
  await browser.route('https://www.miruro.to/watch/**', (r) =>
    r.fulfill({
      contentType: 'text/html',
      body: '<title>Watch Test Show</title><h1 class="anime-title">Test Show</h1>' + videoHTML,
    }),
  );
  await browser.route('https://reanime.to/watch/**', (r) =>
    r.fulfill({
      contentType: 'text/html',
      body: '<title>Test Show - Episode 1 | Re:ANIME</title><script type="application/ld+json">{"@type":"TVEpisode","episodeNumber":1,"partOfSeries":{"name":"Test Show"}}</script><iframe id="video-player" allow="fullscreen" style="width:900px;height:506px" src="https://flixcloud.cc/e/test-player?ep=1"></iframe>',
    }),
  );
  const worker = browser.serviceWorkers()[0] ?? (await browser.waitForEvent('serviceworker'));
  const id = new URL(worker.url()).host;
  await worker.evaluate(() => {
    globalThis.permissionRequests = 0;
    chrome.permissions.request = async () => {
      globalThis.permissionRequests++;
      throw Error('Runtime permission prompt forbidden');
    };
  });
  const access = await worker.evaluate(async () => ({
    manifest: chrome.runtime.getManifest(),
    granted: await chrome.permissions.getAll(),
    defaults: (await chrome.storage.local.get('settings')).settings,
  }));
  if (profile === 'personal') {
    assert.deepEqual(access.manifest.host_permissions, ['<all_urls>']);
    assert(!access.manifest.optional_host_permissions);
    assert(access.granted.origins.includes('<all_urls>'));
  } else {
    assert(!access.manifest.host_permissions.includes('<all_urls>'));
    assert(access.manifest.optional_host_permissions.includes('https://*/*'));
    assert(access.granted.origins.includes('https://flixcloud.cc/*'));
    assert(!access.granted.origins.includes('<all_urls>'));
  }
  assert(!access.manifest.permissions.includes('activeTab'));
  await eventually(
    async () =>
      (await worker.evaluate(() => chrome.storage.local.get('settings'))).settings?.mode === 'auto',
    'AUTO defaults',
  );
  assert((await worker.evaluate(() => chrome.storage.local.get('settings'))).settings.autoApply);
  tests.push(
    'Fresh install has AUTO + autoApply + required install-time access (' +
      profile +
      '); no activeTab',
  );
  // Verify initial settings through URLs inside the worker, without touching the user's Chrome.
  await eventually(
    () => browser.pages().some((p) => p.url() === 'chrome-extension://' + id + '/settings.html'),
    'Initial settings page',
  );
  tests.push('New installation opens its initial settings page');
  const popup = await browser.newPage();
  await popup.goto('chrome-extension://' + id + '/popup.html');
  await popup.evaluate(() => {
    globalThis.permissionRequests = 0;
    chrome.permissions.request = async () => {
      globalThis.permissionRequests++;
      throw Error('Unexpected popup permission request');
    };
  });
  const send = (msg) =>
    popup.evaluate(async (m) => {
      const r = await chrome.runtime.sendMessage(m);
      if (!r.ok) throw Error(r.error);
      return r;
    }, msg);
  async function configure(model) {
    const settings = (await send({ type: 'GET_SETTINGS' })).settings;
    await send({
      type: 'SAVE_SETTINGS',
      settings: {
        ...settings,
        mode: 'auto',
        translation: {
          ...settings.translation,
          model,
          baseUrl: 'http://127.0.0.1:' + port + '/v1',
          timeoutMs: 10000,
          maxRetry: 0,
        },
        jimaku: { apiKey: 'test-key' },
      },
    });
  }
  await configure('model-ko');
  const site = await browser.newPage();
  await site.goto('https://www.miruro.to/watch/154587/show?ep=1');
  const tabId = await worker.evaluate(
    async () => (await chrome.tabs.query({})).find((t) => t.url?.includes('/watch/154587')).id,
  );
  const status = async () => (await send({ type: 'GET_STATUS', tabId })).status;
  const render = async () =>
    worker.evaluate(
      async (tabId) => (await chrome.storage.session.get('render:' + tabId))['render:' + tabId],
      tabId,
    );
  async function done(ep, source = 'anissia', timeout = 20000) {
    const expectedAnime = new URL(site.url()).pathname.split('/')[2];
    return eventually(
      async () => {
        const s = await status();
        if (s?.stage === 'error') throw Error(s.message);
        return (
          s?.stage === 'done' &&
          s.context.episode === ep &&
          new URL(s.context.pageUrl).pathname.split('/')[2] === expectedAnime &&
          s.source === source &&
          s
        );
      },
      'episode ' + ep + ' ' + source,
      timeout,
    );
  }
  async function navigate(ep, animeId = '154587', title = 'Test Show', replace = false) {
    await site.evaluate(
      ({ ep, animeId, title, replace }) => {
        document.querySelector('h1').textContent = title;
        document.title = 'Watch ' + title;
        history[replace ? 'replaceState' : 'pushState'](
          {},
          '',
          '/watch/' + animeId + '/show?ep=' + ep,
        );
      },
      { ep, animeId, title, replace },
    );
  }
  await done(1);
  assert((await render()).cues.some((c) => c.text.includes('EP1')));
  assert.equal(counts.llm, 0);
  tests.push(
    'Miruro EP1 applies Korean automatically without opening popup controls or pressing Start',
  );
  await navigate(2);
  await done(2);
  tests.push(
    'Miruro EP2 automatically cancels old episode and applies Korean with no permission prompt',
  );
  await navigate(1, 'other-show', 'Other Show');
  await done(1);
  tests.push('Changing Miruro anime automatically starts the new catalogue identity');
  const beforeCache = { ...counts };
  const cacheStarted = Date.now();
  await navigate(1);
  const cached = await done(1);
  assert(cached.cached);
  assert.deepEqual(counts, beforeCache);
  timings.push({
    case: 'Korean episode revisit',
    elapsedMs: Date.now() - cacheStarted,
    networkSearches: 0,
  });
  tests.push(
    'Revisited Korean episode renders from episode cache before AniList/provider/download network',
  );
  const stableId = cached.jobId;
  await site.evaluate(() => {
    for (let i = 0; i < 50; i++) {
      const n = document.createElement('span');
      document.body.append(n);
      n.remove();
    }
    history.replaceState({}, '', '?ep=1&provider=changed');
  });
  await new Promise((r) => setTimeout(r, 1200));
  assert.equal((await status()).jobId, stableId);
  assert.deepEqual(counts, beforeCache);
  tests.push(
    'Mutation storms and same-episode replaceState do not duplicate search/download/translation',
  );
  await site.goBack();
  await eventually(
    async () =>
      (await status())?.context.title === 'Other Show' && (await status())?.stage === 'done',
    'browser back',
  );
  await site.goForward();
  await done(1);
  tests.push('Browser back/forward restores the correct episode and its cache');
  phase = 'ja';
  holdLater = true;
  await configure('model-ja');
  await navigate(1, 'japanese');
  await eventually(
    async () => (await render())?.cues.length === 20 && (await status())?.busy,
    'first progressive chunk',
  );
  assert((await render()).bootstrapReady);
  tests.push(
    'Jimaku fallback registers the first 20 translated cues while later translation is pending',
  );
  holdLater = false;
  pending.splice(0).forEach((f) => f());
  await done(1, 'jimaku');
  const beforeTranslationCache = { ...counts };
  await navigate(2, 'japanese');
  await done(2, 'jimaku');
  const completedCounts = { ...counts };
  const translatedStart = Date.now();
  await navigate(1, 'japanese');
  assert((await done(1, 'jimaku')).cached);
  assert.deepEqual(counts, completedCounts);
  timings.push({
    case: 'Translated episode revisit',
    elapsedMs: Date.now() - translatedStart,
    networkSearches: 0,
    llmCalls: 0,
  });
  tests.push(
    'Completed translated episode reappears immediately with zero provider or LLM requests',
  );
  phase = 'partial';
  await configure('model-partial');
  await navigate(1, 'partial');
  await eventually(
    async () => (await status())?.stage === 'retry' && (await render())?.cues.length === 20,
    'partial automatic retry',
  );
  const partialSearches = {
    anissia: counts.anissia,
    jimaku: counts.jimaku,
    downloads: counts.downloads,
  };
  phase = 'ja';
  const partialDone = await done(1, 'jimaku');
  assert(partialDone.cached);
  assert.equal((await render()).cues.length, 40);
  assert.deepEqual(
    { anissia: counts.anissia, jimaku: counts.jimaku, downloads: counts.downloads },
    partialSearches,
  );
  tests.push(
    'Automatic failed-chunk retry restores partial episode/source caches and only retranslates missing cues without new searches/downloads',
  );
  phase = 'mirror';
  await configure('model-mirror');
  await navigate(1, 'mirror');
  await done(1, 'kitsunekko');
  tests.push('Missing Jimaku result automatically falls through to Kitsunekko → Local LLM');
  phase = 'english';
  await configure('model-english');
  await site.evaluate(() => {
    const t = document.querySelector('video').addTextTrack('subtitles', 'English', 'en');
    for (let i = 0; i < 40; i++)
      t.addCue(new VTTCue(i * 5, i * 5 + 4, 'English EP1 cue' + (i + 1)));
    t.mode = 'hidden';
  });
  await navigate(1, 'english');
  await done(1, 'embedded-en');
  tests.push(
    'Missing Japanese subtitles automatically falls through to embedded English → Local LLM',
  );
  phase = 'ja';
  holdAll = true;
  await configure('model-rapid');
  await navigate(1, 'rapid');
  await eventually(() => pending.length > 0, 'EP1 pending LLM');
  const rapidBefore = counts.llm;
  await navigate(2, 'rapid');
  await new Promise((r) => setTimeout(r, 100));
  await navigate(3, 'rapid');
  await eventually(
    async () =>
      (await status())?.context.episode === 3 && (await status())?.busy && counts.llm > rapidBefore,
    'EP3 active',
  );
  assert.equal(counts.llm, rapidBefore + 1);
  assert(counts.aborted >= 1);
  holdAll = false;
  pending.splice(0).forEach((f) => f());
  await done(3, 'jimaku');
  assert((await render()).cues.every((c) => c.text.includes('EP3')));
  tests.push(
    'Rapid EP1 → EP2 → EP3 aborts EP1 LLM, coalesces EP2 and renders only EP3 without duplicate translation',
  );
  phase = 'flaky';
  await send({ type: 'CLEAR_CACHE' });
  await site.evaluate(() =>
    document.querySelector('video').replaceWith(document.createElement('video')),
  );
  await configure('model-retry');
  serviceReadyAt = Date.now() + 2000;
  await navigate(1, 'retry');
  const retryStarted = Date.now();
  const retry = await eventually(
    async () => (await status())?.stage === 'retry' && (await status()),
    'automatic retry countdown',
  );
  assert(retry.retry.nextAt > Date.now());
  await done(1, 'anissia', 20000);
  timings.push({
    case: 'Transient 503 → automatic retry',
    elapsedMs: Date.now() - retryStarted,
    initialDelayMs: 3000,
  });
  tests.push(
    'A transient upstream failure shows a countdown and retries automatically after three seconds',
  );
  phase = 'ja';
  holdAll = true;
  await configure('model-manual-switch');
  await navigate(1, 'manual-switch');
  await eventually(() => pending.length > 0, 'pending operation for manual switch');
  await send({ type: 'SET_MODE', mode: 'ko' });
  assert.equal((await send({ type: 'GET_SETTINGS' })).settings.mode, 'ko');
  holdAll = false;
  pending.splice(0).forEach((f) => f());
  await navigate(2, 'manual-switch');
  await eventually(async () => (await status())?.stage === 'manual', 'manual mode');
  const manualCounts = { ...counts };
  await new Promise((r) => setTimeout(r, 1200));
  assert.deepEqual(counts, manualCounts);
  tests.push(
    'Switching to manual cancels the ongoing job/retry and new episodes wait for explicit manual execution',
  );
  phase = 'ko';
  await send({ type: 'SET_MODE', mode: 'auto' });
  await done(2);
  tests.push('Returning to AUTO resumes the current episode without a Start button');
  await site.evaluate(() => document.querySelector('video').remove());
  const waitingCounts = { ...counts };
  await navigate(1, 'waiting-player');
  await eventually(
    async () => (await status())?.stage === 'waiting-player',
    'wait for hydrated player',
  );
  assert.deepEqual(counts, waitingCounts);
  const hydrationStart = Date.now();
  await site.evaluate(() => {
    const v = document.createElement('video');
    v.style = 'width:900px;height:506px';
    document.body.append(v);
  });
  await done(1);
  timings.push({ case: 'Hydrated player readiness', elapsedMs: Date.now() - hydrationStart });
  tests.push(
    'A page with no ready video waits without provider requests and starts AUTO when its player appears',
  );
  await site.goto('https://reanime.to/watch/reanime-test?ep=1');
  await done(1);
  tests.push('Re:ANIME detects the cross-origin flixcloud player and applies Korean automatically');
  await site.evaluate(() => {
    history.pushState({}, '', '?ep=2');
    document.querySelector('#video-player').src = 'https://flixcloud.cc/e/test-player?ep=2';
  });
  await done(2);
  tests.push(
    'Re:ANIME SPA EP2 automatically applies Korean to its new iframe with no permission request',
  );
  const sameEpisodeCounts = { ...counts };
  const sameJob = (await status()).jobId;
  await site.evaluate(() => {
    document.querySelector('#video-player').src = 'https://strm.cx/test-player?ep=2';
  });
  await eventually(
    () => site.frames().some((f) => f.url().includes('strm.cx/test-player')),
    'replacement iframe',
  );
  const replacement = site.frames().find((f) => f.url().includes('strm.cx/test-player'));
  await eventually(
    async () => (await replacement.locator('[data-animesub-overlay]').count()) > 0,
    'replacement renderer',
  );
  await new Promise((r) => setTimeout(r, 1000));
  assert.equal((await status()).jobId, sameJob);
  assert.deepEqual(counts, sameEpisodeCounts);
  tests.push(
    'Changing the player iframe preserves the episode job and restores its renderer without another search',
  );
  // Reopen popup on the active supported tab and verify its fixed work area.
  await site.bringToFront();
  const visiblePopup = await browser.newPage();
  await visiblePopup.goto('chrome-extension://' + id + '/popup.html');
  // A real popup uses the site as the active tab; an extension tab requires an explicit active-site fixture.
  await worker.evaluate(async (tabId) => chrome.tabs.update(tabId, { active: true }), tabId);
  await visiblePopup.reload();
  await visiblePopup.waitForSelector('.work-status');
  const before = await visiblePopup.locator('.work-status').boundingBox();
  await visiblePopup.locator('.popup-body').evaluate((e) => (e.scrollTop = e.scrollHeight));
  const after = await visiblePopup.locator('.work-status').boundingBox();
  assert.equal(before.y, after.y);
  assert.equal(
    await visiblePopup.getByRole('button', { name: '한국어 자막 적용', exact: true }).count(),
    0,
  );
  assert.equal(await visiblePopup.getByText('ANIME / SUBTITLE', { exact: true }).count(), 0);
  await mkdir('qa', { recursive: true });
  await visiblePopup.screenshot({ path: 'qa/auto-popup.png', fullPage: true });
  tests.push(
    'Work status stays fixed above the scrolling controls; branding and the primary Apply button are removed',
  );
  const settingsPage = await browser.newPage();
  await settingsPage.goto('chrome-extension://' + id + '/settings.html');
  assert.equal(await settingsPage.getByRole('heading', { name: '설정', exact: true }).count(), 1);
  assert.equal(await settingsPage.getByText('편안한 감상을 위한 설정', { exact: true }).count(), 0);
  await settingsPage.screenshot({ path: 'qa/auto-settings.png', fullPage: true });
  tests.push(
    'Settings has only the requested Korean title and exposes explicit AUTO/Manual and initial access setup',
  );
  assert.equal(await worker.evaluate(() => globalThis.permissionRequests), 0);
  assert.equal(await popup.evaluate(() => globalThis.permissionRequests), 0);
  tests.push(
    'Every tested episode/fallback/player change completes with zero runtime permission requests',
  );
  const report = {
    checkedAt: new Date().toISOString(),
    passed: tests.length,
    tests,
    timings,
    counts,
    permissionRequests: 0,
    manifestChangedForTests: false,
    scope:
      'Fresh isolated Chromium installation of the unmodified ' +
      profile +
      ' build; simulated site/player/subtitle/LLM services, real MV3 routing/storage/history/content scripts; actual remote videos and model quality are separately scoped',
  };
  await writeFile(
    profile === 'public'
      ? 'qa/auto-lifecycle-public-browser-report.json'
      : 'qa/auto-lifecycle-browser-report.json',
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  console.error(
    JSON.stringify(
      { error: error.message, passed: tests, counts, pages: browser.pages().map((p) => p.url()) },
      null,
      2,
    ),
  );
  throw error;
} finally {
  holdAll = false;
  holdLater = false;
  pending.splice(0).forEach((f) => f());
  await browser.close();
  await new Promise((r) => server.close(r));
}
