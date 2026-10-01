// Read-only probes of official services; does not use credentials or download media.
import { mkdir, writeFile } from 'node:fs/promises';
const findings = { checkedAt: new Date().toISOString(), services: [] };
async function get(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw Error('HTTP ' + response.status);
  return response;
}
for (const service of ['anissia', 'jimaku', 'kitsunekko', 'gemini']) {
  try {
    if (service === 'anissia') {
      const schedule = await (await get('https://api.anissia.net/anime/schedule/0')).json();
      const anime = schedule.data.find((r) => r.animeNo && r.originalSubject);
      const captions = await (
        await get('https://api.anissia.net/anime/caption/animeNo/' + anime.animeNo)
      ).json();
      findings.services.push({
        service,
        result: 'ok',
        scheduleEnvelope: schedule.code,
        scheduleCount: schedule.data.length,
        animeNo: anime.animeNo,
        captionEnvelope: captions.code,
        captionFields: Object.keys(captions.data[0] ?? {}),
      });
    } else if (service === 'jimaku') {
      const schema = await (await get('https://jimaku.cc/api/openapi.json')).json();
      const response = await fetch('https://jimaku.cc/api/entries/search?anilist_id=154587', {
        signal: AbortSignal.timeout(15000),
      });
      findings.services.push({
        service,
        result: 'schema verified; authenticated requests not tested',
        noKeyStatus: response.status,
        auth: schema.components.securitySchemes.api_key,
        endpoints: Object.keys(schema.paths).filter((p) => /search|files$/.test(p)),
      });
    } else if (service === 'kitsunekko') {
      const html = await (await get('https://subtitles.ajatt.top/')).text();
      const detail = await (
        await get('https://subtitles.ajatt.top/anime_tv/sousou-no-frieren.html')
      ).text();
      const link = [...detail.matchAll(/href="([^"]+)"/g)]
        .map((m) => m[1])
        .find(
          (url) =>
            url.startsWith('https://raw.githubusercontent.com/Ajatt-Tools/kitsunekko-mirror/') &&
            /%2007%20.*ja\.srt$/.test(url),
        );
      if (!link) throw Error('EP07 link not found');
      const raw = await (await get(link)).text();
      if (!raw.includes('-->')) throw Error('Not SRT');
      findings.services.push({
        service,
        result: 'live catalog, detail, EP07 subtitle downloaded',
        indexBytes: html.length,
        entryRows: (html.match(/data-entry-type=/g) ?? []).length,
        fileUrl: link,
        sampleBytes: raw.length,
        hasSrtTimecodes: true,
      });
    } else {
      const schema = await (
        await get('https://generativelanguage.googleapis.com/$discovery/rest?version=v1beta')
      ).json();
      findings.services.push({
        service,
        result: 'official REST schema verified; no real model call',
        jsonSchemaField: !!schema.schemas.GenerationConfig.properties.responseJsonSchema,
      });
    }
  } catch (error) {
    findings.services.push({ service, result: 'failed', error: error.message });
  }
}
await mkdir('qa', { recursive: true });
await writeFile('qa/services-report.json', JSON.stringify(findings, null, 2));
console.log(JSON.stringify(findings, null, 2));
