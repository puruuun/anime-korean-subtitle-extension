import type { AnimeContext } from '../../anime/AnimeContext';
import { titleCandidates } from '../../anime/titleNormalizer';
import { parseEpisode, positiveNumber } from '../../anime/episodeParser';
import type { SourceLanguage, SubtitleProvider, SubtitleSearchResult } from '../SubtitleProvider';
import { request, requestJSON } from '../../background/network';
import { AppError } from '../../utils/errors';
interface Film {
  name: string;
  imdb_id?: string;
  tmdb_id?: number;
  year?: number;
}
interface Item {
  name?: string;
  release_name?: string;
  url: string;
  language?: string;
  lang?: string;
  season?: number;
  episode?: number;
  full_season?: boolean;
  unpack_files?: Item[];
}
interface Response {
  status: boolean;
  error?: string;
  results?: Film[];
  subtitles?: Item[];
}
export class SubDLProvider implements SubtitleProvider {
  id = 'subdl';
  constructor(
    private apiKey: string,
    private signal?: AbortSignal,
  ) {}
  async search(c: AnimeContext, language: SourceLanguage): Promise<SubtitleSearchResult[]> {
    if (!this.apiKey) return [];
    const out: SubtitleSearchResult[] = [];
    const queries: Record<string, string>[] = [];
    if (c.imdbId) queries.push({ imdb_id: c.imdbId });
    if (c.tmdbId) queries.push({ tmdb_id: String(c.tmdbId) });
    queries.push(
      ...titleCandidates(c)
        .slice(0, 6)
        .map((t) => ({ film_name: t })),
    );
    for (const query of queries) {
      this.signal?.throwIfAborted();
      const q = new URLSearchParams({
        api_key: this.apiKey,
        type: 'tv',
        languages: language.toUpperCase(),
        episode_number: String(c.episode),
        subs_per_page: '30',
        unpack: '1',
        ...(c.season ? { season_number: String(c.season) } : {}),
        ...query,
      });
      const r = await requestJSON<Response>(
        'https://api.subdl.com/api/v1/subtitles?' + q,
        {},
        20000,
        this.signal,
      );
      if (!r.status)
        throw new AppError('SUBDL', 'SubDL 검색에 실패했습니다. API Key와 요청 한도를 확인하세요.');
      const film = r.results?.[0];
      for (const item of r.subtitles ?? []) {
        for (const s of item.unpack_files?.length ? item.unpack_files : [item]) {
          const lang = s.language ?? s.lang ?? language;
          const canonical = /^(ko|korean)$/i.test(lang)
            ? 'ko'
            : /^(ja|japanese)$/i.test(lang)
              ? 'ja'
              : undefined;
          if (canonical !== language) continue;
          const url = new URL(s.url, 'https://dl.subdl.com');
          if (url.hostname !== 'dl.subdl.com' || url.protocol !== 'https:') continue;
          out.push({
            id: 'subdl:' + url.pathname,
            providerId: this.id,
            title: film?.name ?? '',
            release: s.release_name ?? s.name ?? '',
            language: canonical,
            episode: !s.full_season
              ? (positiveNumber(s.episode) ?? parseEpisode(s.name ?? s.release_name ?? ''))
              : undefined,
            season: positiveNumber(s.season),
            year: film?.year,
            imdbId: film?.imdb_id,
            tmdbId: film?.tmdb_id,
            downloadUrl: url.href,
          });
        }
      }
    }
    return [...new Map(out.map((r) => [r.id, r])).values()];
  }
  async download(result: SubtitleSearchResult) {
    if (!result.downloadUrl || new URL(result.downloadUrl).hostname !== 'dl.subdl.com')
      throw new AppError('DOWNLOAD', 'SubDL 자막 다운로드 주소가 잘못되었습니다.');
    return request(
      result.downloadUrl,
      { headers: { 'X-API-Key': this.apiKey } },
      30000,
      this.signal,
    );
  }
}
