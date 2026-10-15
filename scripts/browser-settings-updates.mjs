import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
const profile = process.env.ANIMESUB_TEST_PROFILE ?? 'personal';
const dist = resolve(process.env.ANIMESUB_TEST_DIST ?? 'dist');
const currentVersion = JSON.parse(await readFile(join(dist, 'manifest.json'), 'utf8')).version;
const nextParts = currentVersion.split('.').map(Number);
nextParts[nextParts.length - 1]++;
const nextVersion = nextParts.join('.');
const temp = await mkdtemp(join(tmpdir(), 'animesub-settings-'));
const tests = [],
  requests = [];
let phase = 'private',
  delay = 0;
const browser = await chromium.launchPersistentContext(join(temp, 'profile'), {
  channel: 'chromium',
  headless: true,
  ignoreDefaultArgs: ['--disable-extensions'],
  args: ['--disable-extensions-except=' + dist, '--load-extension=' + dist],
  viewport: { width: 1280, height: 1000 },
});
try {
  await browser.route(
    'https://api.github.com/repos/puruuun/anime-korean-subtitle-extension/releases/latest',
    async (route) => {
      const authorization = route.request().headers().authorization;
      requests.push({ phase, authenticated: !!authorization });
      if (authorization) assert.equal(authorization, 'Bearer github_pat_browser_fixture');
      if (delay) await new Promise((r) => setTimeout(r, delay));
      if (phase === 'private' && !authorization)
        return route.fulfill({ status: 404, json: { message: 'Not Found' } });
      if (phase === 'expired')
        return route.fulfill({ status: 401, json: { message: 'Bad credentials' } });
      if (phase === 'forbidden')
        return route.fulfill({ status: 403, json: { message: 'Forbidden' } });
      if (phase === 'rate')
        return route.fulfill({ status: 403, headers: { 'x-ratelimit-remaining': '0' }, json: {} });
      if (phase === 'offline') return route.abort('internetdisconnected');
      return route.fulfill({
        json: {
          tag_name:
            phase === 'newer'
              ? 'v' + nextVersion
              : phase === 'ahead'
                ? 'v0.5.0'
                : phase === 'invalid'
                  ? 'nightly'
                  : 'v' + currentVersion,
          name: 'Settings test Release',
          draft: false,
          prerelease: phase === 'prerelease',
          html_url: 'https://invalid.example/malicious',
          published_at: '2026-10-05T00:00:00Z',
        },
      });
    },
  );
  const worker = browser.serviceWorkers()[0] ?? (await browser.waitForEvent('serviceworker'));
  const id = new URL(worker.url()).host;
  await worker.evaluate(() => {
    globalThis.permissionRequests = 0;
    chrome.permissions.request = async () => {
      globalThis.permissionRequests++;
      throw Error('Unexpected runtime permission request');
    };
  });
  const manifest = await worker.evaluate(() => chrome.runtime.getManifest());
  assert.equal(manifest.version, currentVersion);
  assert.equal(
    await worker.evaluate(() =>
      chrome.permissions.contains({ origins: ['https://api.github.com/*'] }),
    ),
    true,
  );
  if (profile === 'public') assert(manifest.host_permissions.includes('https://api.github.com/*'));
  tests.push('GitHub API is granted at installation in ' + profile + ' build');
  const page = await browser.newPage();
  await page.goto('chrome-extension://' + id + '/settings.html');
  const state = async (expected) => {
    await page.locator('.update-status[data-state="' + expected + '"]').waitFor({ timeout: 15000 });
  };
  const send = (message) =>
    page.evaluate(async (m) => {
      const response = await chrome.runtime.sendMessage(m);
      if (!response?.ok) throw Error(response?.error);
      return response;
    }, message);
  await state('error');
  await page.evaluate(() => {
    globalThis.permissionRequests = 0;
    chrome.permissions.request = async () => {
      globalThis.permissionRequests++;
      throw Error('Unexpected settings permission request');
    };
  });
  assert.match(await page.locator('.update-status').innerText(), /읽기 전용 토큰/);
  assert.match(await page.locator('.update-status').innerText(), /확인하지 못함/);
  tests.push('Private unauthenticated Release shows connection guidance, never latest');
  const guide = page.locator('.permission-guide');
  assert.equal(await guide.locator(':scope > ol > li').count(), 4);
  for (const instruction of [
    '확장프로그램을 켭니다',
    '모든 사이트에서',
    '설정 저장',
    '새로고침',
    '시크릿 모드에서 허용',
  ])
    assert((await guide.innerText()).includes(instruction));
  assert(
    (await guide.innerText()).includes(profile === 'personal' ? '개인용 빌드' : '공개용 빌드'),
  );
  const link = await page.getByRole('button', { name: 'Chrome 사이트 접근 설정' }).boundingBox();
  const guideBox = await guide.boundingBox();
  assert(guideBox.y > link.y);
  tests.push(
    'Four-step permission guide is below Chrome link with matching build instructions and incognito help',
  );
  const model = page.getByLabel('Model ID', { exact: true });
  await model.fill('unsaved-model-draft');
  await page.locator('.update-connection summary').click();
  const token = page.getByLabel('업데이트 조회용 GitHub 토큰', { exact: true });
  await token.fill('github_pat_browser_fixture');
  await page.getByRole('button', { name: '연결하고 확인', exact: true }).click();
  await state('latest');
  assert.equal(await token.inputValue(), '');
  assert(requests.some((r) => r.authenticated));
  assert.equal(await model.inputValue(), 'unsaved-model-draft');
  tests.push(
    'Token connects and immediately checks, clears password field and preserves unsaved settings',
  );
  assert.deepEqual(await send({ type: 'UPDATE_CONNECTION' }), { ok: true, tokenConfigured: true });
  assert(
    !JSON.stringify(await send({ type: 'GET_SETTINGS' })).includes('github_pat_browser_fixture'),
  );
  tests.push(
    'Connection messages expose only presence; normal settings never contain GitHub token',
  );
  await page.getByRole('button', { name: '설정 저장', exact: true }).click();
  assert((await send({ type: 'UPDATE_CONNECTION' })).tokenConfigured);
  assert.equal(
    (await send({ type: 'GET_SETTINGS' })).settings.translation.model,
    'unsaved-model-draft',
  );
  tests.push('Saving regular settings retains update credentials separately');
  const refresh = async (nextPhase, expected) => {
    phase = nextPhase;
    await page.getByRole('button', { name: '업데이트 확인', exact: true }).click();
    await state(expected);
  };
  await refresh('newer', 'available');
  assert((await page.locator('.update-status').innerText()).includes('v' + nextVersion));
  assert((await page.locator('.extension-updates').innerText()).includes('새 버전 설치 방법'));
  assert.equal(
    await page.getByRole('link', { name: 'GitHub Release 열기 ↗' }).getAttribute('href'),
    'https://github.com/puruuun/anime-korean-subtitle-extension/releases/tag/v' + nextVersion,
  );
  tests.push(
    'Newer numeric version displays update needed, download link and folder-preserving installation steps',
  );
  const countBeforeCache = requests.length;
  await page.reload();
  await state('available');
  assert.equal(requests.length, countBeforeCache);
  assert.match(await page.locator('.update-status').innerText(), /저장된 확인 결과/);
  tests.push('Reopening settings uses cached result without duplicate GitHub request');
  await refresh('private', 'latest');
  assert.equal(requests.length, countBeforeCache + 1);
  tests.push('Explicit update check bypasses cache and reports installed version as latest');
  await refresh('ahead', 'ahead');
  assert.match(await page.locator('.update-status').innerText(), /개발 버전/);
  tests.push('Local version ahead of published Release is labeled development version');
  for (const [next, message] of [
    ['expired', '인증에 실패'],
    ['forbidden', '읽기 권한'],
    ['rate', '요청 한도'],
    ['offline', '인터넷 연결'],
    ['invalid', '정식 Release'],
    ['prerelease', '정식 Release'],
  ]) {
    await refresh(next, 'error');
    assert((await page.locator('.update-status').innerText()).includes(message));
    tests.push(next + ' failure never displays latest or update available');
  }
  phase = 'private';
  delay = 250;
  const countBeforeConcurrent = requests.length;
  const [a, b] = await Promise.all([
    send({ type: 'CHECK_UPDATES', force: true }),
    send({ type: 'CHECK_UPDATES', force: true }),
  ]);
  assert.equal(a.status.state, 'latest');
  assert.deepEqual(a, b);
  assert.equal(requests.length, countBeforeConcurrent + 1);
  delay = 0;
  tests.push('Concurrent settings requests share a single in-flight fetch');
  await worker.evaluate(() => {
    globalThis.originalContains = chrome.permissions.contains;
    chrome.permissions.contains = async () => false;
  });
  const countBeforeDenied = requests.length;
  await refresh('private', 'error');
  assert.match(await page.locator('.update-status').innerText(), /권한 가이드/);
  assert.equal(requests.length, countBeforeDenied);
  await worker.evaluate(() => {
    chrome.permissions.contains = globalThis.originalContains;
  });
  tests.push('Revoked site access displays permission guide without requesting a runtime grant');
  await page.locator('.update-connection summary').click();
  await page.getByRole('button', { name: '토큰 연결 해제', exact: true }).click();
  await state('error');
  assert.equal((await send({ type: 'UPDATE_CONNECTION' })).tokenConfigured, false);
  assert(
    !(await worker.evaluate(() => chrome.storage.local.get('githubUpdateToken'))).githubUpdateToken,
  );
  tests.push(
    'Disconnect removes stored credentials and private check returns honest authentication error',
  );
  phase = 'public';
  await refresh('public', 'latest');
  assert.equal(requests.at(-1).authenticated, false);
  tests.push('Public repository can be checked without credentials');
  await page.evaluate(() => {
    globalThis.originalSend = chrome.runtime.sendMessage;
    chrome.runtime.sendMessage = async (...args) => {
      if (args[0]?.type === 'CHECK_UPDATES')
        throw Error('확장프로그램 연결이 끊어졌습니다. 다시 확인하세요.');
      return globalThis.originalSend(...args);
    };
  });
  await refresh('public', 'error');
  assert.match(await page.locator('.update-status').innerText(), /연결이 끊어/);
  assert.match(await page.locator('.update-status').innerText(), /확인하지 못함/);
  await page.evaluate(() => {
    chrome.runtime.sendMessage = globalThis.originalSend;
  });
  tests.push('An extension message failure clears any previous latest status and shows failure');
  await refresh('public', 'latest');
  await mkdir('qa', { recursive: true });
  await page.screenshot({ path: 'qa/settings-updates-' + profile + '.png', fullPage: true });
  await page.setViewportSize({ width: 380, height: 900 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.screenshot({ path: 'qa/settings-updates-' + profile + '-narrow.png', fullPage: true });
  tests.push(
    'Settings, guide and update controls fit a 380px viewport without horizontal overflow',
  );
  assert.equal(await worker.evaluate(() => globalThis.permissionRequests), 0);
  assert.equal(await page.evaluate(() => globalThis.permissionRequests ?? 0), 0);
  tests.push('Every setup/update scenario completes with zero runtime permission requests');
  const report = {
    date: new Date().toISOString(),
    version: manifest.version,
    profile,
    passed: tests,
    count: tests.length,
    requestCount: requests.length,
    permissionRequests: 0,
    boundaries:
      'Fresh isolated Chromium MV3 profile; GitHub API fixture responses and fake test token. User Chrome and real credentials untouched.',
  };
  await writeFile(
    'qa/settings-updates-' + profile + '-report.json',
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  console.error(
    JSON.stringify({ error: error.message, passed: tests, requestCount: requests.length }, null, 2),
  );
  throw error;
} finally {
  await browser.close();
}
