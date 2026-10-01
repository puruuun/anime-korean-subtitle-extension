import type { AnimeContext } from '../../anime/AnimeContext';
import { matchedTitle, titleCandidates } from '../../anime/titleNormalizer';
import { publicSubtitleURL, request, requestJSON } from '../../background/network';
import { log } from '../../utils/logger';
import type {
  JapaneseSubtitleProvider,
  SourceLanguage,
  SubtitleSearchResult,
} from '../SubtitleProvider';
import { japaneseFileCandidate } from '../japanese/fileMatching';

interface Entry {
  id: number;
  name: string;
  english_name?: string;
  japanese_name?: string;
  anilist_id?: number;
}
interface FileEntry {
  name: string;
  url: string;
  last_modified: string;
  size: number;
}
export class JimakuProvider implements JapaneseSubtitleProvider {
  id = 'jimaku' as const;
  constructor(
    private key: string,
    private signal?: AbortSignal,
  ) {}
  async search(
    c: AnimeContext,
    language: SourceLanguage = 'ja',
    signal = this.signal,
  ): Promise<SubtitleSearchResult[]> {
    if (language !== 'ja') return [];
    if (!this.key.trim()) {
      log('Jimaku', { skipped: 'no api key' });
      return [];
    }
    const queries = c.anilistId
      ? ['anilist_id=' + c.anilistId]
      : titleCandidates(c)
          .slice(0, 4)
          .map((title) => 'query=' + encodeURIComponent(title));
    const candidates: SubtitleSearchResult[] = [];
    for (const query of queries) {
      signal?.throwIfAborted();
      log('Jimaku', { searching: c.anilistId ? 'anilist' : 'title', anilistId: c.anilistId });
      const entries = await requestJSON<Entry[]>(
        'https://jimaku.cc/api/entries/search?' + query,
        { headers: { Authorization: this.key } },
        6500,
        signal,
      );
      if (!Array.isArray(entries)) throw Error('Invalid Jimaku entry response');
      for (const entry of entries.slice(0, 4)) {
        if (!Number.isSafeInteger(entry.id)) continue;
        const exactId = !!c.anilistId && entry.anilist_id === c.anilistId;
        if (c.anilistId && !exactId) continue;
        const title = matchedTitle(
          c,
          [entry.name, entry.japanese_name, entry.english_name].filter(
            (t): t is string => typeof t === 'string',
          ),
        );
        if (!exactId && !title) continue;
        const files = await requestJSON<FileEntry[]>(
          'https://jimaku.cc/api/entries/' + entry.id + '/files',
          { headers: { Authorization: this.key } },
          6500,
          signal,
        );
        if (!Array.isArray(files)) continue;
        for (const file of files) {
          if (
            typeof file.name !== 'string' ||
            typeof file.url !== 'string' ||
            file.size > 8 * 1024 * 1024
          )
            continue;
          try {
            const url = publicSubtitleURL(file.url);
            if (new URL(url).hostname !== 'jimaku.cc') continue;
            const candidate = japaneseFileCandidate(
              c,
              this.id,
              {
                title: entry.name,
                matchedTitle: title ?? c.title,
                anilistId: exactId ? c.anilistId : undefined,
              },
              { name: file.name, url, updatedAt: file.last_modified },
            );
            if (candidate) candidates.push(candidate);
          } catch {
            /* Invalid file URL. */
          }
        }
      }
      if (candidates.length) break;
    }
    return [...new Map(candidates.map((r) => [r.id, r])).values()];
  }
  download(candidate: SubtitleSearchResult, signal = this.signal) {
    const url = publicSubtitleURL(candidate.downloadUrl ?? '');
    if (new URL(url).hostname !== 'jimaku.cc') throw Error('Invalid Jimaku file host');
    // File URLs are public; authentication stays on the API origin and is never sent to files.
    return request(url, {}, 6500, signal, true);
  }
}
