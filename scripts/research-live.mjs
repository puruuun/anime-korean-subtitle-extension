import { chromium } from 'playwright';
import { writeFile, mkdir } from 'node:fs/promises';
const browser = await chromium.launch({
  channel: process.platform === 'win32' ? 'msedge' : undefined,
  headless: true,
});
const context = await browser.newContext();
const findings = [];
await context.route('**/*', (route) => {
  const r = route.request();
  if (r.resourceType() === 'media' || /\.(?:ts|m4s|mp4|webm|aac|mp3)(?:[?#]|$)/i.test(r.url()))
    return route.abort();
  return route.continue();
});
try {
  for (const initial of ['https://www.miruro.to/', 'https://reanime.to/watch/naruto-bjfend?ep=1']) {
    const page = await context.newPage();
    try {
      await page.goto(initial, { waitUntil: 'domcontentloaded', timeout: 30000 });
      if (initial === 'https://www.miruro.to/') {
        const link = page.locator('a[href^="/watch/"]').first();
        await link.waitFor({ timeout: 15000 });
        const href = await link.getAttribute('href');
        await page.goto(new URL(href, initial).href, { waitUntil: 'domcontentloaded' });
      }
      await page.waitForTimeout(4000);
      const data = await page.evaluate(() => ({
        url: location.href,
        title: document.title,
        animeTitle: document.querySelector('.anime-title')?.textContent?.trim(),
        headings: [...document.querySelectorAll('h1')]
          .map((e) => e.textContent?.trim())
          .slice(0, 5),
        videoCount: document.querySelectorAll('video').length,
        frame: document.querySelector('#video-player')?.getAttribute('src'),
        iframeCount: document.querySelectorAll('iframe').length,
        tracks: [...document.querySelectorAll('track')].map((t) => ({
          label: t.label,
          language: t.srclang,
        })),
        jsonLD: [...document.querySelectorAll('script[type="application/ld+json"]')].map((s) => {
          try {
            const v = JSON.parse(s.textContent);
            return { type: v['@type'], episode: v.episodeNumber, series: v.partOfSeries?.name };
          } catch {
            return null;
          }
        }),
      }));
      findings.push(data);
    } catch (e) {
      findings.push({ initial, error: e.message });
    }
    await page.close();
  }
  await mkdir('qa', { recursive: true });
  await writeFile('qa/live-site-research.json', JSON.stringify(findings, null, 2));
  console.log(JSON.stringify(findings, null, 2));
} finally {
  await browser.close();
}
