import type { AnimeContext } from '../../anime/AnimeContext';
import { positiveNumber, parseEpisode, parseSeason } from '../../anime/episodeParser';
import { bridgeStore } from '../../content/bridgeStore';
import { siteAnimeId } from '../../anime/AnimeContext';
export function reanimeContext(doc: Document = document, url = location.href): AnimeContext {
  const u = new URL(url);
  let title = '',
    jsonEpisode: number | undefined;
  for (const script of doc.querySelectorAll('script[type="application/ld+json"]')) {
    try {
      const raw = JSON.parse(script.textContent ?? '{}');
      const items = Array.isArray(raw) ? raw : (raw['@graph'] ?? [raw]);
      for (const data of items)
        if (data['@type'] === 'TVEpisode') {
          title = data.partOfSeries?.name ?? '';
          jsonEpisode = positiveNumber(data.episodeNumber);
        }
    } catch {}
  }
  if (!title)
    title = doc.title
      .replace(/\s*-\s*Episode\s*\d+.*$/i, '')
      .replace(/\s*\|\s*Re:ANIME.*$/i, '')
      .trim();
  const episode =
    positiveNumber(u.searchParams.get('ep')) ??
    positiveNumber(doc.querySelector('.ep-card.is-playing')?.getAttribute('data-episode')) ??
    jsonEpisode ??
    parseEpisode(doc.title);
  if (!title || title.includes('Stream Anime Free')) throw Error('작품명을 인식하지 못했습니다.');
  if (!episode) throw Error('회차를 인식하지 못했습니다.');
  const hydration =
    [...doc.scripts].map((s) => s.textContent ?? '').find((s) => s.includes('data:{anime:{')) ?? '';
  const anime = hydration.slice(
    hydration.indexOf('data:{anime:{'),
    hydration.indexOf('data:{anime:{') + 8000,
  );
  const number = (key: string) =>
    positiveNumber(anime.match(new RegExp('\\b' + key + ':(\\d+)'))?.[1]);
  const string = (key: string) => {
    const v = anime.match(new RegExp('\\b' + key + ':("(?:[^"\\\\]|\\\\.)*")'))?.[1];
    try {
      return v ? (JSON.parse(v) as string) : undefined;
    } catch {
      return undefined;
    }
  };
  const m = bridgeStore.metadata.at(-1);
  const mt = typeof m?.title === 'object' ? m.title : undefined;
  return {
    site: 'reanime',
    animeId: siteAnimeId(url),
    title,
    episode,
    season: parseSeason(title),
    year: m?.season_year ?? number('season_year'),
    titles: {
      english: mt?.english ?? string('english'),
      romaji: mt?.romaji ?? string('romaji'),
      japanese: mt?.native ?? string('native'),
    },
    anilistId: m?.anilist_id ?? number('anilist_id'),
    malId: m?.mal_id ?? number('mal_id'),
    tmdbId: m?.themoviedb_id ?? number('themoviedb_id'),
    imdbId: m?.imdb_id ?? string('imdb_id'),
    pageUrl: url,
  };
}
