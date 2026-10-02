import { createServer } from 'node:http';
import { writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const starts = new Map();
const server = createServer((req, res) => {
  const [id, ready] = req.url.slice(1).split('/');
  setTimeout(() => {
    res.statusCode = Date.now() - starts.get(id) >= Number(ready) ? 200 : 503;
    res.end('{}');
  }, 600);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
try {
  const results = await Promise.all(
    [2000, 3000, 5000].flatMap((delay) =>
      [1000, 4500, 9000].map(async (ready) => {
        const id = delay + '-' + ready;
        const start = Date.now();
        starts.set(id, start);
        let calls = 0;
        for (let attempt = 0; attempt < 6; attempt++) {
          calls++;
          const response = await fetch(`http://127.0.0.1:${port}/${id}/${ready}`);
          if (response.ok)
            return {
              initialDelayMs: delay,
              serviceReadyMs: ready,
              elapsedMs: Date.now() - start,
              requests: calls,
            };
          await new Promise((r) =>
            setTimeout(r, [delay, delay * 2, delay * 4, 20000, 20000][attempt]),
          );
        }
        throw Error('Service never recovered');
      }),
    ),
  );
  const averages = [2000, 3000, 5000].map((delay) => ({
    initialDelayMs: delay,
    meanLatencyMs: Math.round(
      results.filter((r) => r.initialDelayMs === delay).reduce((n, r) => n + r.elapsedMs, 0) / 3,
    ),
    requests: results.filter((r) => r.initialDelayMs === delay).reduce((n, r) => n + r.requests, 0),
  }));
  const winner = [...averages].sort((a, b) => a.meanLatencyMs - b.meanLatencyMs)[0];
  assert.equal(winner.initialDelayMs, 3000);
  const report = {
    checkedAt: new Date().toISOString(),
    results,
    averages,
    selectedDelaysMs: [3000, 6000, 12000, 20000, 20000],
    playerCheckMs: 1000,
    episodeDeadlineMs: 120000,
    scope:
      'Controlled real loopback HTTP requests, 600ms response cost, service warmup at 1s/4.5s/9s. Three-second initial delay has lowest mean latency in these scenarios; remote services may vary.',
  };
  await writeFile('qa/auto-retry-timing-report.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally {
  await new Promise((r) => server.close(r));
}
