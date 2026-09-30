import type { AnimeContext } from '../../anime/AnimeContext';
import { titleCandidates } from '../../anime/titleNormalizer';
import { parseEpisode, positiveNumber } from '../../anime/episodeParser';
import type { SourceLanguage, SubtitleProvider, SubtitleSearchResult } from '../SubtitleProvider';
import type { Settings } from '../../storage/settings';
import { request, requestJSON, publicSubtitleURL } from '../../background/network';
import { AppError } from '../../utils/errors';
interface SearchResponse {
  data: {
    id: string;
    attributes: {
      language: string;
      release?: string;
      feature_details?: {
        title?: string;
        parent_title?: string;
        season_number?: number;
        episode_number?: number;
        year?: number;
        parent_imdb_id?: number;
        parent_tmdb_id?: number;
      };
      files: { file_id: number; file_name: string }[];
    };
  }[];
}
export class OpenSubtitlesProvider implements SubtitleProvider {
  id = 'opensubtitles';
  private token: string;
  private baseUrl: string;
  constructor(
    private config: Settings['providers']['opensubtitles'],
    private signal?: AbortSignal,
  ) {
    this.token = config.token;
    this.baseUrl = config.baseUrl;
    const u = new URL(this.baseUrl);
    if (
      !['api.opensubtitles.com', 'vip-api.opensubtitles.com'].includes(u.hostname) ||
      u.protocol !== 'https:'
    )
      throw new AppError('URL', 'OpenSubtitles 서버 주소를 확인하세요.');
  }
  private headers() {
    return {
      'Api-Key': this.config.apiKey,
      'X-User-Agent': 'AnimeKoreanSubtitle v0.1.0',
      'User-Agent': 'AnimeKoreanSubtitle v0.1.0',
      ...(this.token ? { Authorization: 'Bearer ' + this.token } : {}),
    };
  }
  async login() {
    if (!this.config.username || !this.config.password)
      throw new AppError(
        'AUTH',
        'OpenSubtitles 다운로드에는 Token 또는 Username / Password가 필요합니다.',
      );
    const r = await requestJSON<{ token: string; base_url: string }>(
      this.baseUrl + '/login',
      {
        method: 'POST',
        headers: { ...this.headers(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: this.config.username, password: this.config.password }),
      },
      20000,
      this.signal,
    );
    if (!r.token) throw new AppError('AUTH', 'OpenSubtitles 로그인에 실패했습니다.');
    const u = new URL(r.base_url.includes('://') ? r.base_url : 'https://' + r.base_url);
    if (!['api.opensubtitles.com', 'vip-api.opensubtitles.com'].includes(u.hostname))
      throw new AppError('URL', 'OpenSubtitles 인증 서버가 잘못되었습니다.');
    this.token = r.token;
    this.baseUrl = u.origin + '/api/v1';
    return { token: this.token, baseUrl: this.baseUrl };
  }
  async search(c: AnimeContext, language: SourceLanguage): Promise<SubtitleSearchResult[]> {
    if (!this.config.apiKey) return [];
    const out: SubtitleSearchResult[] = [];
    const queries: Record<string, string>[] = [];
    if (c.imdbId) queries.push({ parent_imdb_id: c.imdbId.replace(/^tt/, '') });
    if (c.tmdbId) queries.push({ parent_tmdb_id: String(c.tmdbId) });
    queries.push(
      ...titleCandidates(c)
        .slice(0, 6)
        .map((t) => ({ query: t })),
    );
    for (const query of queries) {
      const q = new URLSearchParams({
        type: 'episode',
        languages: language,
        episode_number: String(c.episode),
        ...(c.season ? { season_number: String(c.season) } : {}),
        ...query,
      });
      const r = await requestJSON<SearchResponse>(
        this.baseUrl + '/subtitles?' + q,
        { headers: this.headers() },
        20000,
        this.signal,
      );
      for (const entry of r.data ?? []) {
        const a = entry.attributes;
        if (a.language !== language) continue;
        const f = a.feature_details;
        for (const file of a.files ?? [])
          out.push({
            id: 'opensubtitles:' + file.file_id,
            providerId: this.id,
            title: f?.parent_title ?? f?.title ?? '',
            release: a.release ?? file.file_name,
            language,
            episode: positiveNumber(f?.episode_number) ?? parseEpisode(file.file_name),
            season: positiveNumber(f?.season_number),
            year: f?.year,
            imdbId: f?.parent_imdb_id
              ? 'tt' + String(f.parent_imdb_id).padStart(7, '0')
              : undefined,
            tmdbId: f?.parent_tmdb_id,
            fileId: file.file_id,
          });
      }
    }
    return [...new Map(out.map((r) => [r.id, r])).values()];
  }
  async download(result: SubtitleSearchResult) {
    if (!result.fileId) throw new AppError('DOWNLOAD', '자막 파일 ID가 없습니다.');
    if (!this.token) await this.login();
    const r = await requestJSON<{ link: string }>(
      this.baseUrl + '/download',
      {
        method: 'POST',
        headers: { ...this.headers(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ file_id: result.fileId, sub_format: 'srt' }),
      },
      20000,
      this.signal,
    );
    if (!r.link) throw new AppError('DOWNLOAD', '자막 다운로드 링크를 받지 못했습니다.');
    return request(publicSubtitleURL(r.link), {}, 30000, this.signal);
  }
}
