import type { AnimeContext } from './AnimeContext';
import { normalizeTitle, titleCandidates } from './titleNormalizer';
import { requestJSON } from '../background/network';
interface Media {
  id: number;
  idMal?: number;
  title: { english?: string; romaji?: string; native?: string };
  synonyms: string[];
  startDate?: { year?: number };
}
export async function resolveAnime(c: AnimeContext, signal?: AbortSignal): Promise<AnimeContext> {
  try {
    const filter = c.anilistId ? 'id:$id' : c.malId ? 'idMal:$mal' : 'search:$search';
    const r = await requestJSON<{ data?: { Media: Media } }>(
      'https://graphql.anilist.co',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query:
            'query($id:Int,$mal:Int,$search:String){Media(' +
            filter +
            ',type:ANIME){id idMal title{english romaji native} synonyms startDate{year}}}',
          variables: {
            id: c.anilistId,
            mal: c.malId,
            search: !c.anilistId && !c.malId ? c.title : undefined,
          },
        }),
      },
      15000,
      signal,
    );
    const m = r.data?.Media;
    if (!m) return c;
    const exact =
      c.anilistId === m.id ||
      !!(c.malId && c.malId === m.idMal) ||
      [m.title.english, m.title.romaji, m.title.native, ...m.synonyms].some(
        (t) => t && titleCandidates(c).some((a) => normalizeTitle(a) === normalizeTitle(t)),
      );
    if (!exact) return c;
    return {
      ...c,
      anilistId: m.id,
      malId: c.malId ?? m.idMal,
      year: c.year ?? m.startDate?.year,
      titles: {
        ...c.titles,
        english: m.title.english ?? c.titles?.english,
        romaji: m.title.romaji ?? c.titles?.romaji,
        japanese: m.title.native ?? c.titles?.japanese,
        synonyms: [...new Set([...(c.titles?.synonyms ?? []), ...m.synonyms])],
      },
    };
  } catch {
    signal?.throwIfAborted();
    return c;
  }
}
