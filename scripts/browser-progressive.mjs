import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';

const report = [];
const requests = [];
let phase = 'normal';
let context;
let worker;
let tabId;
let popup;
const cueCount = 140;
const source = Array.from({ length: cueCount }, (_, index) => ({
  id: index + 1,
  startTime: index * 10,
  endTime: index * 10 + 8,
  text: 'English line ' + (index + 1),
}));
function stamp(seconds) {
  return new Date(seconds * 1000).toISOString().slice(11, 23);
}
const vtt =
  'WEBVTT\n\n' +
  source
    .map(
      (cue) =>
        cue.id + '\n' + stamp(cue.startTime) + ' --> ' + stamp(cue.endTime) + '\n' + cue.text,
    )
    .join('\n\n');

async function eventually(predicate, description, timeout = 15000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = await predicate();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  throw Error('Timed out: ' + description);
}
function pass(message) {
  report.push(message);
  console.log('PASS ' + message);
}
const local = createServer(async (req, res) => {
  if (req.url === '/v1/models') {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ data: [{ id: 'progressive-normal' }] }));
    return;
  }
  let body = '';
  for await (const bytes of req) body += bytes;
  try {
    const input = JSON.parse(body);
    const payload = JSON.parse(input.messages.at(-1).content);
    const cues = payload.toTranslate;
    assert(cues.every((cue) => Object.keys(cue).every((key) => ['id', 'text'].includes(key))));
    const record = {
      phase,
      model: input.model,
      ids: cues.map((cue) => cue.id),
      aborted: false,
      answered: false,
      release: undefined,
    };
    requests.push(record);
    res.on('close', () => {
      if (!res.writableEnded) record.aborted = true;
    });
    record.release = (invalid = false) => {
      if (record.answered || record.aborted || res.destroyed) return;
      record.answered = true;
      res.setHeader('Content-Type', 'application/json');
      res.end(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  translations: invalid
                    ? []
                    : cues.map((cue) => ({ id: cue.id, text: '한국어 ' + cue.id })),
                }),
              },
              finish_reason: 'stop',
            },
          ],
        }),
      );
    };
    const first = record.ids[0];
    const matching = requests.filter((r) => r.phase === record.phase && r.ids[0] === first);
    const hold =
      matching.length === 1 &&
      ((phase === 'normal' && [1, 21, 66].includes(first)) ||
        (phase === 'immediate' && [1, 21].includes(first)));
    if (!hold) record.release(phase === 'failure' && first === 21);
  } catch (error) {
    res.statusCode = 500;
    res.end('invalid test request');
    console.error(error.message);
  }
});
await new Promise((resolve) => local.listen(0, '127.0.0.1', resolve));
const port = local.address().port;
const profile = await mkdtemp(join(tmpdir(), 'animesub-progressive-'));
const dist = resolve('dist');
const options = {
  headless: true,
  ignoreDefaultArgs: ['--disable-extensions'],
  args: ['--disable-extensions-except=' + dist, '--load-extension=' + dist],
  viewport: { width: 1280, height: 900 },
};
if (process.env.ANIMESUB_BROWSER_CHANNEL) options.channel = process.env.ANIMESUB_BROWSER_CHANNEL;
else if (process.platform === 'win32') options.channel = 'msedge';

// Install the same controllable media fixture in MAIN and ISOLATED worlds. DOM attributes
// provide shared backing state across worlds; no real video, audio, or model is downloaded.
function controlledVideo() {
  const video = document.querySelector('video');
  video.dataset.testTime ??= '2';
  video.dataset.testPaused ??= 'false';
  Object.defineProperties(video, {
    currentTime: {
      configurable: true,
      get: () => Number(video.dataset.testTime),
      set: (time) => {
        video.dataset.testTime = String(time);
      },
    },
    paused: { configurable: true, get: () => video.dataset.testPaused === 'true' },
    requestVideoFrameCallback: { configurable: true, value: undefined },
    play: {
      configurable: true,
      value: () => {
        video.dataset.testPaused = 'false';
        video.dispatchEvent(new Event('play'));
        return Promise.resolve();
      },
    },
    pause: {
      configurable: true,
      value: () => {
        video.dataset.testPaused = 'true';
        video.dispatchEvent(new Event('pause'));
      },
    },
  });
}
async function status() {
  return popup.evaluate(
    async (tabId) => (await chrome.runtime.sendMessage({ type: 'GET_STATUS', tabId })).status,
    tabId,
  );
}
async function render() {
  return worker.evaluate(
    async (tabId) => (await chrome.storage.session.get('render:' + tabId))['render:' + tabId],
    tabId,
  );
}
async function configure(model, immediatePlayback) {
  await worker.evaluate(
    async ({ model, immediatePlayback, port }) => {
      const settings = {
        mode: 'en',
        translation: {
          provider: 'lmstudio',
          baseUrl: 'http://127.0.0.1:' + port + '/v1',
          apiKey: '',
          model,
          chunkSize: 45,
          initialChunkSize: 20,
          targetBufferSeconds: 300,
          immediatePlayback,
          maxCharacters: 5000,
          contextCues: 5,
          temperature: 0.2,
          timeoutMs: 20000,
          maxRetry: 1,
          structured: 'json_schema',
        },
        providers: {
          subdl: { enabled: false, apiKey: '', priority: 1 },
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
      await chrome.storage.local.set({ settings });
    },
    { model, immediatePlayback, port },
  );
}
async function beginRun() {
  const before = await status();
  await popup.getByText('사이트 영어 자막 → 한국어', { exact: true }).click();
  await popup.getByRole('button', { name: '한국어 자막 적용', exact: true }).click();
  return eventually(async () => {
    const current = await status();
    if (current?.stage === 'error') throw Error(current.message);
    return current?.jobId !== before?.jobId && current;
  }, 'new episode job');
}
async function done(episode) {
  return eventually(
    async () => {
      const current = await status();
      if (current?.stage === 'error') throw Error(current.message);
      return (
        current?.context?.episode === episode &&
        !current.busy &&
        ['done', 'partial'].includes(current.stage) &&
        current
      );
    },
    'background queue completion',
    25000,
  );
}
function held(first, requestPhase) {
  return eventually(
    () =>
      requests.find(
        (record) =>
          record.phase === requestPhase &&
          record.ids[0] === first &&
          !record.answered &&
          !record.aborted,
      ),
    'held request ' + requestPhase + '/' + first,
  );
}

try {
  context = await chromium.launchPersistentContext(profile, options);
  await context.route('https://graphql.anilist.co/**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '{"data":null}' }),
  );
  await context.route('https://cdn.example/progressive.vtt', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'text/vtt',
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: vtt,
    }),
  );
  const fixture =
    '<!doctype html><html><head><meta charset="utf-8"><title>Watch Test Show · Miruro</title></head>' +
    '<body style="margin:0;background:#12121c;color:white"><h1 class="anime-title">Test Show</h1>' +
    '<div style="width:900px;height:506px"><video controls crossorigin="anonymous" style="width:100%;height:100%">' +
    '<track src="https://cdn.example/progressive.vtt" kind="subtitles" srclang="en" label="English" default>' +
    '</video></div></body></html>';
  await context.route('https://www.miruro.to/**', (route) =>
    route.fulfill({ status: 200, contentType: 'text/html', body: fixture }),
  );
  const site = await context.newPage();
  await site.goto('https://www.miruro.to/watch/test?ep=1');
  worker =
    context.serviceWorkers()[0] ??
    (await context.waitForEvent('serviceworker', { timeout: 15000 }));
  const extensionId = new URL(worker.url()).host;
  tabId = await worker.evaluate(
    async () => (await chrome.tabs.query({})).find((tab) => tab.url?.includes('/watch/test'))?.id,
  );
  assert(tabId);
  await site.waitForSelector('[data-animesub-overlay]');
  await site.evaluate(controlledVideo);
  await worker.evaluate(async (tabId) => {
    function controlledVideo() {
      const video = document.querySelector('video');
      video.dataset.testTime ??= '2';
      video.dataset.testPaused ??= 'false';
      Object.defineProperties(video, {
        currentTime: {
          configurable: true,
          get: () => Number(video.dataset.testTime),
          set: (time) => {
            video.dataset.testTime = String(time);
          },
        },
        paused: { configurable: true, get: () => video.dataset.testPaused === 'true' },
        requestVideoFrameCallback: { configurable: true, value: undefined },
        play: {
          configurable: true,
          value: () => {
            video.dataset.testPaused = 'false';
            video.dispatchEvent(new Event('play'));
            return Promise.resolve();
          },
        },
        pause: {
          configurable: true,
          value: () => {
            video.dataset.testPaused = 'true';
            video.dispatchEvent(new Event('pause'));
          },
        },
      });
    }
    await chrome.scripting.executeScript({
      target: { tabId, frameIds: [0] },
      world: 'ISOLATED',
      func: controlledVideo,
    });
  }, tabId);
  await site.evaluate(() => {
    const video = document.querySelector('video');
    video.textTracks[0].mode = 'showing';
  });
  const opened = context.waitForEvent('page');
  await worker.evaluate(
    async ({ tabId, url }) => {
      await chrome.tabs.update(tabId, { active: true });
      await chrome.tabs.create({ url, active: false });
    },
    { tabId, url: 'chrome-extension://' + extensionId + '/popup.html' },
  );
  popup = await opened;
  await popup.waitForSelector('.mode');

  await configure('progressive-normal', false);
  await beginRun();
  const first = await held(1, 'normal');
  assert.equal(first.ids.length, 20);
  assert.equal(await site.evaluate(() => document.querySelector('video').paused), true);
  assert.equal((await render()).cues.length, 0);
  pass(
    'Initial request contains only 20 cues; normal playback waits only for the small initial chunk',
  );

  first.release();
  const second = await held(21, 'normal');
  await eventually(async () => (await render())?.cues.length === 20, 'first chunk registered');
  assert.equal((await status()).busy, true);
  assert.equal((await render()).bootstrapReady, true);
  assert.equal(await site.evaluate(() => document.querySelector('video').paused), false);
  pass(
    'First 20 translated cues are registered and playback resumes while later translation remains pending',
  );
  await popup.locator('.translation-buffer').waitFor();
  const bufferText = await popup.locator('.translation-buffer').innerText();
  assert(
    bufferText.includes('번역 중') &&
      bufferText.includes('현재 재생') &&
      bufferText.includes('번역 완료') &&
      bufferText.includes('Buffer') &&
      bufferText.includes('5m 0s'),
  );
  pass(
    'Popup displays current playback, continuous translated horizon, buffer and the five-minute target',
  );

  await site.evaluate(() => {
    const video = document.querySelector('video');
    video.currentTime = 1080;
    video.dispatchEvent(new Event('seeking'));
    video.dispatchEvent(new Event('seeked'));
  });
  const sought = await held(66, 'normal');
  await eventually(() => second.aborted, 'irrelevant request aborted on seek');
  const normalOrder = requests
    .filter((record) => record.phase === 'normal')
    .map((record) => record.ids[0]);
  assert.deepEqual(normalOrder.slice(0, 3), [1, 21, 66]);
  assert.equal((await status()).translation.playbackTime, 1080);
  assert.equal((await status()).translation.bufferSeconds, 0);
  pass(
    'Seeking to 18 minutes aborts the unrelated chunk and prioritizes the chunk covering the new position',
  );

  sought.release();
  await done(1);
  const completed = await render();
  assert.equal(completed.cues.length, cueCount);
  assert.deepEqual(
    completed.cues.map(({ id, startTime, endTime }) => ({ id, startTime, endTime })),
    source.map(({ id, startTime, endTime }) => ({ id, startTime, endTime })),
  );
  pass('Background queue finishes the whole episode with original cue IDs and times preserved');

  phase = 'cache';
  const cachedCalls = requests.length;
  await beginRun();
  await done(1);
  assert.equal(requests.length, cachedCalls);
  pass('A repeated episode restores all chunk caches without any new LLM requests');

  phase = 'immediate';
  await configure('progressive-immediate', true);
  await site.evaluate(() => {
    const video = document.querySelector('video');
    video.currentTime = 2;
    void video.play();
    video.dispatchEvent(new Event('seeked'));
  });
  await beginRun();
  const immediateFirst = await held(1, 'immediate');
  assert.equal(await site.evaluate(() => document.querySelector('video').paused), false);
  assert.equal(
    await site.evaluate(() => document.querySelector('video').textTracks[0].mode),
    'showing',
  );
  immediateFirst.release();
  const immediateSecond = await held(21, 'immediate');
  await eventually(async () => (await render())?.cues.length === 20, 'immediate first chunk');
  await eventually(
    () => site.evaluate(() => document.querySelector('video').textTracks[0].mode === 'hidden'),
    'source-to-Korean switch',
  );
  pass(
    'Immediate mode keeps video playing and source English visible until the first Korean chunk becomes available',
  );

  const old = await status();
  phase = 'spa';
  await site.evaluate(() => history.pushState({}, '', '?ep=2'));
  await eventually(() => immediateSecond.aborted, 'previous episode aborted by SPA navigation');
  const next = await done(2);
  assert(next.epoch > old.epoch && next.jobId !== old.jobId);
  assert.equal((await render()).cues.length, cueCount);
  pass(
    'SPA episode change aborts the previous request, advances the epoch and starts a fresh episode queue',
  );

  phase = 'failure';
  await configure('progressive-failure', true);
  await beginRun();
  const partial = await done(2);
  assert.equal(partial.stage, 'partial');
  assert.equal(partial.translation.failedChunks, 1);
  assert.equal((await render()).cues.length, cueCount - 45);
  assert.equal(
    requests.filter((record) => record.phase === 'failure' && record.ids[0] === 21).length,
    2,
  );
  const failedCalls = requests.length;
  phase = 'failure-retry';
  await beginRun();
  await done(2);
  assert.deepEqual(
    requests.slice(failedCalls).map((record) => record.ids[0]),
    [21],
  );
  assert.equal((await render()).cues.length, cueCount);
  pass(
    'Only the failed chunk retries; other chunks remain usable and a rerun restores caches before retrying the missing chunk',
  );

  await mkdir('qa', { recursive: true });
  await popup.screenshot({ path: 'qa/progressive-popup.png', fullPage: true });
  await writeFile(
    'qa/progressive-report.json',
    JSON.stringify(
      {
        browser: options.channel ?? 'chromium',
        passed: report.length,
        tests: report,
        requests: requests.map(({ phase, model, ids, aborted }) => ({
          phase,
          model,
          firstCue: ids[0],
          cueCount: ids.length,
          aborted,
        })),
      },
      null,
      2,
    ),
  );
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  console.error(
    JSON.stringify(
      {
        error: error.message,
        status: popup ? await status().catch(() => null) : undefined,
        render: worker
          ? await render()
              .then((r) => ({
                epoch: r?.epoch,
                cues: r?.cues?.length,
                bootstrapReady: r?.bootstrapReady,
              }))
              .catch(() => null)
          : undefined,
        requests: requests.map(({ phase, ids, aborted, answered }) => ({
          phase,
          firstCue: ids[0],
          cueCount: ids.length,
          aborted,
          answered,
        })),
      },
      null,
      2,
    ),
  );
  throw error;
} finally {
  if (context) await context.close();
  local.closeAllConnections();
  await new Promise((resolve) => local.close(resolve));
}
