import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const dist = resolve('dist');
const report = [];

async function launchExtension(options = {}, extraArgs = []) {
  const profile = await mkdtemp(join(tmpdir(), 'websub-mobile-qa-'));
  const context = await chromium.launchPersistentContext(profile, {
    channel: 'chromium',
    headless: true,
    ignoreDefaultArgs: ['--disable-extensions'],
    args: ['--disable-extensions-except=' + dist, '--load-extension=' + dist, ...extraArgs],
    ...options,
  });
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
  const id = new URL(worker.url()).host;
  return { context, id };
}

// 1. Desktop fine-pointer viewport: .popup must keep full intrinsic 420x600 size.
{
  const { context, id } = await launchExtension({ viewport: { width: 1280, height: 800 } });
  try {
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${id}/popup.html`);
    await popup.locator('.popup').waitFor();
    const isCoarse = await popup.evaluate(
      () => window.matchMedia('(hover: none) and (pointer: coarse)').matches,
    );
    assert.equal(isCoarse, false, 'Desktop context should not match mobile coarse-pointer query');
    const box = await popup.locator('.popup').boundingBox();
    assert(
      box && box.width >= 400 && box.height >= 500,
      `Desktop .popup collapsed or undersized: ${JSON.stringify(box)}`,
    );
    report.push(`Desktop popup rendered at ${Math.round(box.width)}x${Math.round(box.height)}px`);

    const settings = await context.newPage();
    await settings.goto(`chrome-extension://${id}/settings.html`);
    await settings.locator('h1').waitFor();
    const overflow = await settings.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    assert.equal(overflow, false, 'Desktop settings page overflowed horizontally');
    report.push('Desktop settings rendered with zero horizontal overflow');
  } finally {
    await context.close();
  }
}

// 2. Mobile touch viewport (375x667, iPhone SE width): popup & settings must fit with zero overflow.
{
  const { context, id } = await launchExtension(
    {
      viewport: { width: 375, height: 667 },
      isMobile: true,
      hasTouch: true,
    },
    ['--blink-settings=primaryPointerType=2,availablePointerTypes=2,primaryHoverType=1,availableHoverTypes=1'],
  );
  try {
    const site = await context.newPage();
    await context.route('https://example.com/**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: '<!doctype html><html><head><title>Sample Video</title></head><body><video></video></body></html>',
      }),
    );
    await site.goto('https://example.com/watch?v=mobile-test');

    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${id}/popup.html`);
    await popup.locator('.popup').waitFor();
    const isCoarse = await popup.evaluate(
      () => window.matchMedia('(hover: none) and (pointer: coarse)').matches,
    );
    assert.equal(isCoarse, true, 'Mobile touch context should match coarse-pointer media query');
    const popupBox = await popup.locator('.popup').boundingBox();
    assert(
      popupBox && popupBox.width >= 320 && popupBox.width <= 375 && popupBox.height >= 400,
      `Mobile .popup out of bounds: ${JSON.stringify(popupBox)}`,
    );
    const popupScroll = await popup.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    assert(
      popupScroll.scrollWidth <= popupScroll.clientWidth,
      `Mobile popup horizontal overflow: ${JSON.stringify(popupScroll)}`,
    );
    report.push(
      `Mobile 375px touch popup fit cleanly (${Math.round(popupBox.width)}x${Math.round(popupBox.height)}px, scrollWidth=${popupScroll.scrollWidth})`,
    );

    const settings = await context.newPage();
    await settings.goto(`chrome-extension://${id}/settings.html`);
    await settings.locator('h1').waitFor();
    const settingsScroll = await settings.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    assert(
      settingsScroll.scrollWidth <= settingsScroll.clientWidth,
      `Mobile settings horizontal overflow: ${JSON.stringify(settingsScroll)}`,
    );
    report.push(
      `Mobile 375px settings fit cleanly (scrollWidth=${settingsScroll.scrollWidth}/${settingsScroll.clientWidth})`,
    );
  } finally {
    await context.close();
  }
}

await mkdir('qa', { recursive: true });
await writeFile(
  'qa/mobile-viewport-report.json',
  JSON.stringify({ checkedAt: new Date().toISOString(), passed: report.length, tests: report }, null, 2),
);
console.log(JSON.stringify(report, null, 2));
