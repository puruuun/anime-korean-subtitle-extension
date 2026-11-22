import type { AnimeContext } from '../../anime/AnimeContext';
import { positiveNumber, parseSeason } from '../../anime/episodeParser';
import { bridgeStore } from '../../content/bridgeStore';
import { siteAnimeId } from '../../anime/AnimeContext';
function miruroJsonLd(doc: Document): { name?: string; anilistId?: number } {
  for (const script of doc.querySelectorAll('script[type="application/ld+json"]')) {
    try {
      const parsed = JSON.parse(script.textContent ?? '');
      const items = Array.isArray(parsed) ? parsed : [parsed];
      for (const item of items) {
        if (!item || typeof item !== 'object') continue;
        const type = item['@type'];
        if (type === 'TVSeries' || type === 'TVEpisode' || type === 'Movie') {
          const name =
            (typeof item.partOfSeries?.name === 'string' && item.partOfSeries.name.trim()) ||
            (typeof item.name === 'string' && item.name.trim()) ||
            undefined;
          const image = typeof item.image === 'string' ? item.image : '';
          const idMatch = image.match(
            /anilistcdn\/media\/anime\/(?:banner|cover\/[a-z]+)\/(?:[a-z]+)?(\d+)/i,
          );
          const anilistId = positiveNumber(idMatch?.[1]);
          if (name || anilistId) return { name, anilistId };
        }
      }
    } catch {}
  }
  return {};
}
export function miruroContext(doc: Document = document, url = location.href): AnimeContext {
  const u = new URL(url);
  const episode = positiveNumber(u.searchParams.get('ep'));
  const ld = miruroJsonLd(doc);
  const title =
    doc.querySelector('.anime-title')?.textContent?.trim() ||
    ld.name ||
    doc.title
      .replace(/^Watch\s+/i, '')
      .replace(/\s*[-–—·|]\s*Miruro.*$/i, '')
      .trim();
  if (!title || /^Miruro$/i.test(title) || /Watch Anime Online|Miruro\s*[-·|]/i.test(title))
    throw Error('작품명을 인식하지 못했습니다.');
  if (!episode)
    throw Error('회차를 인식하지 못했습니다. 재생 회차를 선택하거나 Popup에서 입력하세요.');
  const meta = bridgeStore.metadata.at(-1);
  const titles =
    typeof meta?.title === 'object'
      ? { english: meta.title.english, romaji: meta.title.romaji, japanese: meta.title.native }
      : undefined;
  const ids = meta?.external_ids ?? {};
  const first = (v: unknown) => (Array.isArray(v) ? v[0] : v);
  return {
    site: 'miruro',
    animeId: siteAnimeId(url),
    title,
    titles,
    episode,
    season: parseSeason(title),
    year: meta?.season_year,
    anilistId: positiveNumber(first(ids.anilist)) ?? ld.anilistId,
    malId: positiveNumber(first(ids.mal)),
    tmdbId: positiveNumber(first(ids.tmdb)),
    imdbId: typeof first(ids.imdb) === 'string' ? String(first(ids.imdb)) : undefined,
    pageUrl: url,
  };
}
