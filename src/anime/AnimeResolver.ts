import type { AnimeContext } from './AnimeContext';
import { matchedTitle, titleCandidates, titleSignature } from './titleNormalizer';
import { requestJSON } from '../background/network';
interface Media {
  id: number;
  idMal?: number;
  type?: string;
  format?: string;
  episodes?: number;
  title: { english?: string; romaji?: string; native?: string };
  synonyms?: string[];
  startDate?: { year?: number };
  relations?: { edges: { relationType: string; node: Media }[] };
}
const fields =
  'id idMal type format episodes title{english romaji native} synonyms startDate{year} relations{edges{relationType node{id type format episodes title{english romaji native}}}}';
async function media(
  filter: 'id' | 'idMal' | 'search',
  value: string | number,
  signal?: AbortSignal,
) {
  const variable = filter === 'search' ? 'String' : 'Int';
  const r = await requestJSON<{ data?: { Media?: Media } }>(
    'https://graphql.anilist.co',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: `query($value:${variable}){Media(${filter}:$value,type:ANIME){${fields}}}`,
        variables: { value },
      }),
    },
    15000,
    signal,
  );
  return r.data?.Media;
}
const aliases = (m: Media) =>
  [m.title.english, m.title.romaji, m.title.native, ...(m.synonyms ?? [])].filter(
    (t): t is string => !!t,
  );
async function precedingEpisodes(m: Media, c: AnimeContext, signal?: AbortSignal) {
  const season =
    c.season ??
    titleCandidates(c)
      .map((t) => titleSignature(t).season)
      .find(Boolean) ??
    1;
  if (c.episodeType || season < 2 || season > 6) return undefined;
  let current = m,
    offset = 0;
  const seen = new Set([m.id]);
  for (let previousSeason = season - 1; previousSeason >= 1; previousSeason--) {
    const candidates = (current.relations?.edges ?? []).filter(
      ({ relationType, node }) =>
        relationType === 'PREQUEL' &&
        node.type === 'ANIME' &&
        node.format === 'TV' &&
        Number.isSafeInteger(node.episodes) &&
        Number(node.episodes) > 0 &&
        !!matchedTitle({ ...c, season: previousSeason }, aliases(node)),
    );
    if (candidates.length !== 1 || seen.has(candidates[0].node.id)) return undefined;
    const previous = candidates[0].node;
    seen.add(previous.id);
    offset += previous.episodes!;
    if (previousSeason > 1) {
      const loaded = await media('id', previous.id, signal);
      if (!loaded) return undefined;
      current = loaded;
    }
  }
  return offset;
}
export async function resolveAnime(c: AnimeContext, signal?: AbortSignal): Promise<AnimeContext> {
  try {
    const filter = c.anilistId ? 'id' : c.malId ? 'idMal' : 'search';
    const m = await media(filter, c.anilistId ?? c.malId ?? c.title, signal);
    if (!m) return c;
    const exact =
      c.anilistId === m.id || !!(c.malId && c.malId === m.idMal) || !!matchedTitle(c, aliases(m));
    if (!exact) return c;
    const enriched = {
      ...c,
      anilistId: m.id,
      malId: c.malId ?? m.idMal,
      year: c.year ?? m.startDate?.year,
      titles: {
        ...c.titles,
        english: m.title.english ?? c.titles?.english,
        romaji: m.title.romaji ?? c.titles?.romaji,
        japanese: m.title.native ?? c.titles?.japanese,
        synonyms: [...new Set([...(c.titles?.synonyms ?? []), ...(m.synonyms ?? [])])],
      },
      episodeOffset: undefined as number | undefined,
    };
    // A prequel outage must not discard the title needed for Korean subtitle matching.
    try {
      enriched.episodeOffset = await precedingEpisodes(m, enriched, signal);
    } catch {
      signal?.throwIfAborted();
    }
    return enriched;
  } catch {
    signal?.throwIfAborted();
    return c;
  }
}
