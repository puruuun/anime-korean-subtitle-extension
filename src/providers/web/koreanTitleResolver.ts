import type { AnimeContext } from '../../anime/AnimeContext';
import { normalizeTitle, titleCandidates } from '../../anime/titleNormalizer';
import { requestJSON } from '../../background/network';
import { database, type Database } from '../../storage/database';

const TTL = 7 * 24 * 60 * 60 * 1000;

interface WikidataClaim {
  mainsnak?: {
    datavalue?: {
      value?: unknown;
    };
  };
}

interface WikidataEntity {
  id: string;
  labels?: Record<string, { language: string; value: string }>;
  aliases?: Record<string, { language: string; value: string }[]>;
  claims?: Record<string, WikidataClaim[]>;
}

interface WikidataSearchResult {
  search?: { id: string }[];
}

interface WikidataEntitiesResult {
  entities?: Record<string, WikidataEntity>;
}

function stripSeasonSuffix(text: string): string {
  return text
    .normalize('NFKC')
    .replace(
      /(?:\bseason\s*\d+|\b\d+(?:st|nd|rd|th)\s*season\b|\bs\d{1,2}\b|第\s*\d+\s*期|\b\d+\s*기|\bpart\s*\d+|\bcour\s*\d+)/gi,
      ' ',
    )
    .replace(/\s+/g, ' ')
    .trim();
}

function hasMatchingId(entity: WikidataEntity, anilistId?: number, malId?: number): boolean {
  if (anilistId) {
    const values = entity.claims?.P8729?.map((c) => String(c.mainsnak?.datavalue?.value));
    if (values?.includes(String(anilistId))) return true;
  }
  if (malId) {
    const values = entity.claims?.P4086?.map((c) => String(c.mainsnak?.datavalue?.value));
    if (values?.includes(String(malId))) return true;
  }
  return false;
}

function matchesTitle(entity: WikidataEntity, term: string): boolean {
  const normTerm = normalizeTitle(term);
  if (!normTerm) return false;
  for (const lang of ['ja', 'en', 'ko']) {
    const label = entity.labels?.[lang]?.value;
    if (label && normalizeTitle(label) === normTerm) return true;
    for (const alias of entity.aliases?.[lang] ?? []) {
      if (normalizeTitle(alias.value) === normTerm) return true;
    }
  }
  return false;
}

export async function resolveKoreanTitles(
  c: AnimeContext,
  signal?: AbortSignal,
  db: Pick<Database, 'get' | 'put'> = database,
): Promise<string[]> {
  const existingKo = titleCandidates(c).filter((t) => /[\uAC00-\uD7A3]/.test(t));
  if (existingKo.length > 0) return existingKo;

  const cacheKey = JSON.stringify([
    'wikidata:ko:v1',
    c.anilistId ?? '',
    c.malId ?? '',
    c.titles?.japanese ?? c.nativeTitle ?? c.title,
  ]);

  const cached = await db
    .get<{ expiresAt: number; titles: string[] }>(cacheKey)
    .catch(() => undefined);
  signal?.throwIfAborted();
  if (cached && cached.expiresAt > Date.now() && Array.isArray(cached.titles)) {
    return cached.titles;
  }

  const rawTerms = [c.titles?.japanese, c.nativeTitle, c.title, c.titles?.english, c.titles?.romaji]
    .filter((t): t is string => !!t?.trim())
    .map(stripSeasonSuffix)
    .filter(Boolean);

  const searchTerms = [...new Set(rawTerms)].slice(0, 2);
  const foundTitles: string[] = [];

  try {
    for (const term of searchTerms) {
      signal?.throwIfAborted();
      const lang = /[\u3040-\u30ff\u4e00-\u9faf]/.test(term) ? 'ja' : 'en';
      const searchUrl = `https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${encodeURIComponent(
        term,
      )}&language=${lang}&uselang=ko&format=json&limit=5&origin=*`;

      const searchData = await requestJSON<WikidataSearchResult>(searchUrl, {}, 4000, signal);
      const ids = (searchData.search ?? []).map((s) => s.id).filter(Boolean);
      if (!ids.length) continue;

      signal?.throwIfAborted();
      const getUrl = `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${ids
        .slice(0, 5)
        .join('|')}&props=labels|aliases|claims&languages=ko|ja|en&format=json&origin=*`;

      const getData = await requestJSON<WikidataEntitiesResult>(getUrl, {}, 4000, signal);
      const entities = Object.values(getData.entities ?? {});

      const idMatch = entities.find((e) => hasMatchingId(e, c.anilistId, c.malId));
      const chosen = idMatch ?? entities.find((e) => matchesTitle(e, term));

      if (chosen) {
        if (chosen.labels?.ko?.value && /[\uAC00-\uD7A3]/.test(chosen.labels.ko.value)) {
          foundTitles.push(chosen.labels.ko.value.trim());
        }
        for (const alias of chosen.aliases?.ko ?? []) {
          if (alias.value && /[\uAC00-\uD7A3]/.test(alias.value)) {
            foundTitles.push(alias.value.trim());
          }
        }
        if (foundTitles.length) break;
      }
    }
  } catch (e) {
    if (signal?.aborted) throw signal.reason;
    return [];
  }

  const seasonExpanded: string[] = [];
  for (const t of foundTitles) {
    if (c.season && c.season > 1 && !/(?:제?\s*\d+\s*기|\bseason\s*\d+)/i.test(t)) {
      seasonExpanded.push(`${t} ${c.season}기`);
    }
    seasonExpanded.push(t);
  }

  const koTitles = [...new Set(seasonExpanded)];
  signal?.throwIfAborted();
  await db.put(cacheKey, { expiresAt: Date.now() + TTL, titles: koTitles }).catch(() => {});

  return koTitles;
}
