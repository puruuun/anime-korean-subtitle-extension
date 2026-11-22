import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const dist = resolve('dist');
const report = [];
const profile = await mkdtemp(join(tmpdir(), 'websub-websearch-qa-'));
const context = await chromium.launchPersistentContext(profile, {
  channel: 'chromium',
  headless: true,
  ignoreDefaultArgs: ['--disable-extensions'],
  args: ['--disable-extensions-except=' + dist, '--load-extension=' + dist],
  viewport: { width: 1280, height: 800 },
});

const srt = (line) => `1\n00:00:00,000 --> 00:00:30,000\n${line}\n`;

try {
  await context.route('https://graphql.anilist.co/**', (r) => r.fulfill({ json: { data: null } }));
  await context.route('https://www.wikidata.org/**', (r) =>
    r.fulfill({ json: { search: [], entities: {} } }),
  );
  await context.route('https://api.anissia.net/**', (r) =>
    r.fulfill({ json: { code: 'ok', data: [] } }),
  );
  await context.route('https://jimaku.cc/**', (r) => r.fulfill({ json: [] }));
  await context.route('https://subtitles.ajatt.top/**', (r) =>
    r.fulfill({ contentType: 'text/html', body: '<table></table>' }),
  );
  await context.route('https://html.duckduckgo.com/**', (r) =>
    r.fulfill({ status: 202, body: 'bot challenge' }),
  );

  await context.route('https://search.naver.com/**', (r) =>
    r.fulfill({
      contentType: 'text/html; charset=utf-8',
      body: `<!doctype html><html><body>
        <a href="https://submaker.blogspot.com/2026/10/ep1.html">2026.10.05. 새 창 열림</a>
        <a href="https://submaker.blogspot.com/2026/10/ep1.html">submaker.blogspot.com › ep1 새 창 열림</a>
        <a href="https://submaker.blogspot.com/2026/10/ep1.html">푸른 상자 2기 1화 한국어 자막 배포 새 창 열림</a>
        <a href="https://submaker.blogspot.com/2026/10/ep1.html">직접 다운로드 가능한 SRT 자막 첨부 새 창 열림</a>
        <a href="https://reviewblog.tistory.com/99">2026.10.06. 새 창 열림</a>
        <a href="https://reviewblog.tistory.com/99">푸른 상자 2기 1화 자막 없는 리뷰 글 새 창 열림</a>
        <a href="https://reviewblog.tistory.com/99">자막 첨부는 없고 감상만 적었습니다. 새 창 열림</a>
      </body></html>`,
    }),
  );

  await context.route('https://submaker.blogspot.com/2026/10/ep1.html', (r) =>
    r.fulfill({
      contentType: 'text/html; charset=utf-8',
      body: `<!doctype html><html><head><title>푸른 상자 2기 1화 한국어 자막</title></head><body>
        <article><a href="https://files.submaker.example/bluebox-s2-01.srt">1화 자막 다운로드 (.srt)</a></article>
      </body></html>`,
    }),
  );
  await context.route('https://files.submaker.example/bluebox-s2-01.srt', (r) =>
    r.fulfill({
      contentType: 'text/plain; charset=utf-8',
      body: srt('웹 검색으로 적용된 푸른 상자 자막'),
    }),
  );
  await context.route('https://files.submaker.example/direct-paste.srt', (r) =>
    r.fulfill({
      contentType: 'text/plain; charset=utf-8',
      body: srt('URL 직접 붙여넣기 자막'),
    }),
  );
  await context.route('https://reviewblog.tistory.com/99', (r) =>
    r.fulfill({
      contentType: 'text/html; charset=utf-8',
      body: '<!doctype html><html><body><p>여기는 리뷰만 있고 파일이 없습니다.</p></body></html>',
    }),
  );

  const watchHtml = `<!doctype html><html><head><title>Blue Box Season 2 - Episode 1 | Re:ANIME</title>
    <script type="application/ld+json">{"@type":"TVEpisode","episodeNumber":1,"partOfSeries":{"name":"Blue Box Season 2"}}</script>
  </head><body><div style="width:900px;height:506px;position:relative"><video style="width:100%;height:100%" controls></video></div></body></html>`;
  await context.route('https://reanime.cz/**', (r) =>
    r.fulfill({ contentType: 'text/html; charset=utf-8', body: watchHtml }),
  );

  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
  const id = new URL(worker.url()).host;

  // Put extension in manual mode so AUTO does not race our interactive search test.
  await worker.evaluate(async () => {
    const cur = (await chrome.storage.local.get('settings')).settings ?? {};
    await chrome.storage.local.set({ settings: { ...cur, mode: 'ko', autoApply: false } });
  });

  const site = await context.newPage();
  await site.goto('https://reanime.cz/watch/blue-box-season-2-3m552p?ep=1');
  await site.locator('video').waitFor();
  await site.waitForSelector('[data-animesub-overlay]');

  const popupPromise = context.waitForEvent('page');
  await worker.evaluate(
    async (url) => {
      await chrome.tabs.create({ url, active: false });
    },
    `chrome-extension://${id}/popup.html`,
  );
  const popup = await popupPromise;
  await popup.locator('.web-search').waitFor();

  // Wait for active tab context + suggested query to populate, then search.
  const searchInput = popup.getByLabel('웹 자막 검색어 또는 URL');
  await searchInput.fill('푸른 상자 2기 1화 자막');
  await popup.locator('.web-search-form button[type="submit"]').click();

  const items = popup.locator('.web-search-item');
  await items.first().waitFor();
  assert.equal(await items.count(), 2, 'Expected 2 ranked Naver search results');
  report.push('Popup web search parsed multi-anchor Naver HTML into 2 ranked result cards');

  // 1. Apply the review card without a file -> inline fallback note + external page link stay visible.
  const reviewCard = items.filter({ hasText: '자막 없는 리뷰 글' });
  await reviewCard.getByRole('button', { name: '자막 적용' }).click();
  await reviewCard.locator('.web-search-note').waitFor();
  assert.equal(await reviewCard.getByRole('link', { name: /원본 페이지 열기/ }).count(), 1);
  report.push('Result without downloadable subtitle shows inline fallback note and external link');

  async function readRenderedSubtitle(page) {
    await page.evaluate(() => {
      const v = document.querySelector('video');
      if (v) {
        v.currentTime = 2;
        v.dispatchEvent(new Event('seeked'));
      }
    });
    const cdp = await context.newCDPSession(page);
    try {
      for (let i = 0; i < 30; i++) {
        const { root } = await cdp.send('DOM.getDocument', { depth: -1, pierce: true });
        let foundNode = null;
        function scan(node) {
          if (foundNode) return;
          const attrs = node.attributes ?? [];
          const idx = attrs.indexOf('class');
          if (idx >= 0 && attrs[idx + 1] === 'primary-subtitle') {
            foundNode = node;
            return;
          }
          for (const child of [
            ...(node.children ?? []),
            ...(node.shadowRoots ?? []),
            ...(node.contentDocument ? [node.contentDocument] : []),
          ]) {
            scan(child);
          }
        }
        scan(root);
        if (foundNode) {
          const { outerHTML } = await cdp.send('DOM.getOuterHTML', {
            backendNodeId: foundNode.backendNodeId,
          });
          if (outerHTML && outerHTML.replace(/<[^>]+>/g, '').trim()) return outerHTML;
        }
        await new Promise((r) => setTimeout(r, 100));
      }
      return '';
    } finally {
      await cdp.detach();
    }
  }

  // 2. Apply the blogspot card with .srt link -> downloads, parses, renders on video!
  const subCard = items.filter({ hasText: '한국어 자막 배포' });
  await subCard.getByRole('button', { name: '자막 적용' }).click();
  await popup.locator('.work-message').filter({ hasText: '웹 자막 적용 완료' }).waitFor();

  const renderedText = await readRenderedSubtitle(site);
  assert(
    renderedText.includes('웹 검색으로 적용된 푸른 상자 자막'),
    `Expected rendered Korean web subtitle in video page, got: ${renderedText}`,
  );
  report.push('Clicking Apply on a web search result extracts, parses, and renders subtitle on video');

  // 3. Direct URL paste in the search box applies immediately.
  await searchInput.fill('https://files.submaker.example/direct-paste.srt');
  await popup.locator('.web-search-form button[type="submit"]').click();
  await popup
    .locator('.work-message')
    .filter({ hasText: 'files.submaker.example' })
    .waitFor();
  const pastedText = await readRenderedSubtitle(site);
  assert(
    pastedText.includes('URL 직접 붙여넣기 자막'),
    `Expected direct pasted URL subtitle on video, got: ${pastedText}`,
  );
  report.push('Direct URL paste in popup web search applies subtitle immediately');

  // 4. Desktop popup layout remains intact (no horizontal overflow, >= 400x500).
  const metrics = await popup.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
    rect: document.querySelector('.popup')?.getBoundingClientRect(),
  }));
  assert(
    metrics.rect && metrics.rect.width >= 400 && metrics.rect.height >= 500,
    `Desktop popup undersized: ${JSON.stringify(metrics.rect)}`,
  );
  assert(
    metrics.scrollWidth <= metrics.clientWidth,
    `Desktop popup overflowed horizontally: ${JSON.stringify(metrics)}`,
  );
  report.push('Popup with web search results maintains 420x600 layout with zero horizontal overflow');

  await mkdir('qa', { recursive: true });
  await writeFile(
    'qa/web-search-report.json',
    JSON.stringify({ checkedAt: new Date().toISOString(), passed: report.length, tests: report }, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));
} finally {
  await context.close();
}
