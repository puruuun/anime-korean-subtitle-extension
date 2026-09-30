import type { AnimeContext } from '../../anime/AnimeContext';
import { positiveNumber, parseSeason } from '../../anime/episodeParser';
import { bridgeStore } from '../../content/bridgeStore';
export function miruroContext(doc: Document = document, url = location.href): AnimeContext {
  const u = new URL(url);
  const episode = positiveNumber(u.searchParams.get('ep'));
  const title =
    doc.querySelector('.anime-title')?.textContent?.trim() ||
    doc.title
      .replace(/^Watch\s+/i, '')
      .replace(/\s*[·|]\s*Miruro.*$/i, '')
      .trim();
  if (!title || /Watch Anime Online|Miruro ·/i.test(title))
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
    title,
    titles,
    episode,
    season: parseSeason(title),
    year: meta?.season_year,
    anilistId: positiveNumber(first(ids.anilist)),
    malId: positiveNumber(first(ids.mal)),
    tmdbId: positiveNumber(first(ids.tmdb)),
    imdbId: typeof first(ids.imdb) === 'string' ? String(first(ids.imdb)) : undefined,
    pageUrl: url,
  };
}
