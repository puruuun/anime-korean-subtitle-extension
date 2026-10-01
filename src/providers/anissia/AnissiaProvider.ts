import type { AnimeContext } from '../../anime/AnimeContext';
import { normalizeEpisode } from '../../anime/episodeNormalizer';
import { requestJSON } from '../../background/network';
import { database, type Database } from '../../storage/database';
import { AppError } from '../../utils/errors';
import type {
  SourceLanguage,
  SubtitleProvider,
  SubtitleSearchResult,
  SubtitleCandidate,
} from '../SubtitleProvider';
import { matchAnissiaTitle, type AnissiaAnime } from './titleMatching';
import { SubtitleLinkResolverChain } from '../../subtitle/links/SubtitleLinkResolverChain';
import { SubtitleLinkUnavailable } from '../../subtitle/links/SubtitleLinkResolver';
import { subtitleURL } from '../../subtitle/links/resourceLoader';

export const ANISSIA_SCHEDULE_TTL = 5 * 60 * 1000;
const API = 'https://api.anissia.net/anime/';
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
  private async schedules(): Promise<AnissiaAnime[]> {
    const key = 'anissia:schedule:v1';
    const cached = await this.cache.get<ScheduleCache>(key).catch(() => undefined);
    this.signal?.throwIfAborted();
    if (cached && cached.expiresAt > this.now() && Array.isArray(cached.items)) return cached.items;
    const weeks = await Promise.allSettled(
      Array.from({ length: 9 }, (_, week) =>
        requestJSON<unknown>(API + 'schedule/' + week, {}, 8000, this.signal).then(rows),
      ),
    );
    this.signal?.throwIfAborted();
    const available = weeks.flatMap((week) => (week.status === 'fulfilled' ? week.value : []));
    if (weeks.every((week) => week.status === 'rejected'))
      throw new AppError('ANISSIA_API', 'Anissia 편성표에 연결할 수 없습니다.');
    const items = [
      ...new Map(
        available.flatMap((row) =>
          Number.isSafeInteger(row.animeNo) &&
          Number(row.animeNo) > 0 &&
          typeof row.subject === 'string'
            ? [
                [
                  Number(row.animeNo),
                  {
                    animeNo: Number(row.animeNo),
                    subject: row.subject,
                    originalSubject:
                      typeof row.originalSubject === 'string' ? row.originalSubject : '',
                    startDate: typeof row.startDate === 'string' ? row.startDate : '',
                    endDate: typeof row.endDate === 'string' ? row.endDate : '',
                  } satisfies AnissiaAnime,
                ] as const,
              ]
            : [],
        ),
      ).values(),
    ];
    // Do not cache a partial outage as a complete empty schedule.
    if (weeks.every((week) => week.status === 'fulfilled')) {
      await this.cache
        .put(key, { expiresAt: this.now() + ANISSIA_SCHEDULE_TTL, items })
        .catch(() => {});
    }
    return items;
  }
  async search(c: AnimeContext, language: SourceLanguage): Promise<SubtitleCandidate[]> {
    if (language !== 'ko') return [];
    const episode = normalizeEpisode(c.episode);
    if (episode === undefined) return [];
    const matches = (await this.schedules()).flatMap((anime) => {
      const matchedTitle = matchAnissiaTitle(c, anime);
      return matchedTitle ? [{ anime, matchedTitle }] : [];
    });
    const requests = await Promise.allSettled(
      matches.map(async ({ anime, matchedTitle }) => {
        const captions = rows(
          await requestJSON<unknown>(
            API + 'caption/animeNo/' + anime.animeNo,
            {},
            8000,
            this.signal,
          ),
        );
        return captions.flatMap((row): SubtitleCandidate[] => {
          if (
            typeof row.episode !== 'string' ||
            normalizeEpisode(row.episode) !== episode ||
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
              id: JSON.stringify(['anissia', anime.animeNo, episode, author, pageUrl, updatedAt]),
              provider: 'anissia',
              providerId: 'anissia',
              language: 'ko',
              title: anime.subject,
              matchedTitle,
              release: anime.subject + ' · ' + author,
              episode: row.episode,
              season: c.season,
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
    this.signal?.throwIfAborted();
    if (requests.length && requests.every((r) => r.status === 'rejected'))
      throw new AppError('ANISSIA_API', 'Anissia 자막 목록에 연결할 수 없습니다.');
    return [
      ...new Map(
        requests.flatMap((r) => (r.status === 'fulfilled' ? r.value : [])).map((r) => [r.id, r]),
      ).values(),
    ];
  }
  async download(candidate: SubtitleSearchResult): Promise<ArrayBuffer> {
    const resolution = await this.resolver.resolve(candidate, this.signal);
    if (resolution.kind === 'page') throw new SubtitleLinkUnavailable(resolution);
    return resolution.buffer;
  }
}
