import type { AnimeContext } from '../../anime/AnimeContext';
import { normalizeEpisode } from '../../anime/episodeNormalizer';
import { titleCandidates } from '../../anime/titleNormalizer';
import { requestJSON } from '../../background/network';
import { database, type Database } from '../../storage/database';
import { AppError } from '../../utils/errors';
import type {
  SourceLanguage,
  SubtitleProvider,
  SubtitleSearchResult,
  AnissiaSubtitleCandidate,
} from '../SubtitleProvider';
import { matchAnissiaTitle, type AnissiaAnime } from './titleMatching';
import { SubtitleLinkResolverChain } from '../../subtitle/links/SubtitleLinkResolverChain';
import { SubtitleLinkUnavailable } from '../../subtitle/links/SubtitleLinkResolver';
import { subtitleURL } from '../../subtitle/links/resourceLoader';

export const ANISSIA_SCHEDULE_TTL = 5 * 60 * 1000;
const API = 'https://api.anissia.net/anime/';
function animeRows(data: Record<string, unknown>[]): AnissiaAnime[] {
  return data.flatMap((row) =>
    Number.isSafeInteger(row.animeNo) && Number(row.animeNo) > 0 && typeof row.subject === 'string'
      ? [
          {
            animeNo: Number(row.animeNo),
            subject: row.subject,
            originalSubject: typeof row.originalSubject === 'string' ? row.originalSubject : '',
            startDate: typeof row.startDate === 'string' ? row.startDate : '',
            endDate: typeof row.endDate === 'string' ? row.endDate : '',
          },
        ]
      : [],
  );
}
export function anissiaSearchQueries(c: AnimeContext): string[] {
  const titles = titleCandidates(c)
    .map((t) => t.normalize('NFKC').trim())
    .sort(
      (a, b) =>
        Number(/[\p{Script=Hangul}\p{Script=Han}\p{Script=Katakana}]/u.test(b)) -
        Number(/[\p{Script=Hangul}\p{Script=Han}\p{Script=Katakana}]/u.test(a)),
    );
  // Anissia's text index splits Japanese kanji and kana. A whole native title can return zero hits.
  const tokens = titles.flatMap((t) => {
    const kana = t.match(/[\p{Script=Katakana}ー]{2,}/gu) ?? [];
    const words = (t.match(/[\p{Script=Hangul}]{2,}|[a-zA-Z]{4,}/gu) ?? []).filter(
      (w) => !/^(?:season|part|cour|the|with|from)$/i.test(w),
    );
    const kanji = t.match(/\p{Script=Han}/u)?.[0];
    return [
      ...kana.sort((a, b) => b.length - a.length),
      ...words.sort((a, b) => b.length - a.length),
      ...(kanji ? [kanji] : []),
    ];
  });
  return [...new Set([...titles.slice(0, 3), ...tokens])].slice(0, 8);
}
function rows(response: unknown): Record<string, unknown>[] {
  const data = Array.isArray(response)
    ? response
    : response && typeof response === 'object' && (response as { code?: string }).code === 'ok'
      ? (response as { data?: unknown }).data
      : undefined;
  if (!Array.isArray(data))
    throw new AppError('ANISSIA_API', 'Anissia 응답 형식이 잘못되었습니다.');
  return data.filter((row): row is Record<string, unknown> => !!row && typeof row === 'object');
}
interface ScheduleCache {
  expiresAt: number;
  items: AnissiaAnime[];
}
export class AnissiaProvider implements SubtitleProvider {
  id = 'anissia' as const;
  constructor(
    private signal?: AbortSignal,
    private resolver = new SubtitleLinkResolverChain(),
    private cache: Pick<Database, 'get' | 'put'> = database,
    private now: () => number = Date.now,
  ) {}
  private async schedules(signal = this.signal): Promise<AnissiaAnime[]> {
    const key = 'anissia:schedule:v1';
    const cached = await this.cache.get<ScheduleCache>(key).catch(() => undefined);
    signal?.throwIfAborted();
    if (cached && cached.expiresAt > this.now() && Array.isArray(cached.items)) return cached.items;
    const weeks = await Promise.allSettled(
      Array.from({ length: 9 }, (_, week) =>
        requestJSON<unknown>(API + 'schedule/' + week, {}, 8000, signal).then(rows),
      ),
    );
    signal?.throwIfAborted();
    const available = weeks.flatMap((week) => (week.status === 'fulfilled' ? week.value : []));
    if (weeks.every((week) => week.status === 'rejected'))
      throw new AppError('ANISSIA_API', 'Anissia 편성표에 연결할 수 없습니다.');
    const items = [
      ...new Map(animeRows(available).map((anime) => [anime.animeNo, anime])).values(),
    ];
    // Do not cache a partial outage as a complete empty schedule.
    if (weeks.every((week) => week.status === 'fulfilled')) {
      await this.cache
        .put(key, { expiresAt: this.now() + ANISSIA_SCHEDULE_TTL, items })
        .catch(() => {});
    }
    return items;
  }
  private async catalogue(c: AnimeContext, signal?: AbortSignal): Promise<AnissiaAnime[]> {
    const queries = await Promise.allSettled(
      anissiaSearchQueries(c).map(async (query) => {
        const key = JSON.stringify(['anissia:search:v1', query]);
        const cached = await this.cache.get<ScheduleCache>(key).catch(() => undefined);
        signal?.throwIfAborted();
        if (cached && cached.expiresAt > this.now() && Array.isArray(cached.items))
          return cached.items;
        const items: AnissiaAnime[] = [];
        for (let page = 0; page < 4; page++) {
          const response = await requestJSON<unknown>(
            API + 'list/' + page + '?q=' + encodeURIComponent(query),
            {},
            8000,
            signal,
          );
          const data =
            response &&
            typeof response === 'object' &&
            (response as { code?: string }).code === 'ok'
              ? (response as { data?: unknown }).data
              : response;
          const content = Array.isArray(data)
            ? data
            : (data as { content?: unknown } | undefined)?.content;
          if (!Array.isArray(content))
            throw new AppError('ANISSIA_API', 'Anissia 전체 작품 검색 응답이 잘못되었습니다.');
          items.push(...animeRows(content));
          const pages = (data as { totalPages?: number })?.totalPages;
          if (
            Array.isArray(data) ||
            (data as { last?: boolean })?.last ||
            !pages ||
            page + 1 >= pages
          ) {
            signal?.throwIfAborted();
            await this.cache
              .put(key, { expiresAt: this.now() + ANISSIA_SCHEDULE_TTL, items })
              .catch(() => {});
            break;
          }
        }
        return items;
      }),
    );
    signal?.throwIfAborted();
    if (queries.length && queries.every((r) => r.status === 'rejected'))
      throw new AppError('ANISSIA_API', 'Anissia 전체 작품 검색에 연결할 수 없습니다.');
    return [
      ...new Map(
        queries
          .flatMap((r) => (r.status === 'fulfilled' ? r.value : []))
          .map((a) => [a.animeNo, a]),
      ).values(),
    ];
  }
  async search(
    c: AnimeContext,
    language: SourceLanguage,
    signal = this.signal,
  ): Promise<AnissiaSubtitleCandidate[]> {
    if (language !== 'ko') return [];
    const episode = normalizeEpisode(c.episode);
    if (episode === undefined) return [];
    let scheduleError: unknown;
    const scheduled = await this.schedules(signal).catch((error) => {
      scheduleError = error;
      return [];
    });
    signal?.throwIfAborted();
    const match = (items: AnissiaAnime[]) =>
      items.flatMap((anime) => {
        const matchedTitle = matchAnissiaTitle(c, anime);
        return matchedTitle ? [{ anime, matchedTitle }] : [];
      });
    let matches = match(scheduled);
    if (!matches.length) {
      try {
        matches = match(await this.catalogue(c, signal));
      } catch (error) {
        signal?.throwIfAborted();
        throw scheduleError ?? error;
      }
    }
    const fileEpisodes = [episode];
    if (!c.episodeType && Number.isSafeInteger(c.episodeOffset) && Number(c.episodeOffset) > 0)
      fileEpisodes.push(normalizeEpisode(c.episode + c.episodeOffset!)!);
    const requests = await Promise.allSettled(
      matches.map(async ({ anime, matchedTitle }) => {
        const captions = rows(
          await requestJSON<unknown>(API + 'caption/animeNo/' + anime.animeNo, {}, 8000, signal),
        );
        return captions.flatMap((row): AnissiaSubtitleCandidate[] => {
          if (
            typeof row.episode !== 'string' ||
            normalizeEpisode(row.episode) === undefined ||
            typeof row.website !== 'string' ||
            !row.website.trim()
          )
            return [];
          let pageUrl: string;
          try {
            pageUrl = subtitleURL(row.website.trim());
          } catch {
            return [];
          }
          const author = typeof row.name === 'string' ? row.name : '';
          const updatedAt = typeof row.updDt === 'string' ? row.updDt : '';
          return [
            {
              ...anime,
              id: JSON.stringify([
                'anissia',
                anime.animeNo,
                episode,
                row.episode,
                author,
                pageUrl,
                updatedAt,
              ]),
              provider: 'anissia',
              providerId: 'anissia',
              language: 'ko',
              title: anime.subject,
              matchedTitle,
              release: anime.subject + ' · ' + author,
              episode: normalizeEpisode(row.episode) === episode ? row.episode : episode,
              listedEpisode: row.episode,
              fileEpisodes,
              requireEpisodeMatch: !fileEpisodes.includes(normalizeEpisode(row.episode)!),
              season: c.season,
              episodeType: c.episodeType,
              year: /^\d{4}-/.test(anime.startDate)
                ? Number(anime.startDate.slice(0, 4))
                : undefined,
              author,
              pageUrl,
              updatedAt,
            },
          ];
        });
      }),
    );
    signal?.throwIfAborted();
    if (requests.length && requests.every((r) => r.status === 'rejected'))
      throw new AppError('ANISSIA_API', 'Anissia 자막 목록에 연결할 수 없습니다.');
    return [
      ...new Map(
        requests.flatMap((r) => (r.status === 'fulfilled' ? r.value : [])).map((r) => [r.id, r]),
      ).values(),
    ];
  }
  async download(candidate: SubtitleSearchResult, signal = this.signal): Promise<ArrayBuffer> {
    const resolution = await this.resolver.resolve(candidate, signal);
    if (resolution.kind === 'page') throw new SubtitleLinkUnavailable(resolution);
    return resolution.buffer;
  }
}
