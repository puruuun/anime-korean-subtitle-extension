import type { AnimeContext } from '../../anime/AnimeContext';
import { matchedTitle } from '../../anime/titleNormalizer';
import { request, publicSubtitleURL } from '../../background/network';
import { database } from '../../storage/database';
import { plainText } from '../../subtitle/SubtitleParser';
import { htmlSubtitleLinks } from '../../subtitle/links/GenericHtmlResolver';
import { fileName } from '../../subtitle/links/DirectFileResolver';
import type {
  JapaneseSubtitleProvider,
  SourceLanguage,
  SubtitleSearchResult,
} from '../SubtitleProvider';
import { japaneseFileCandidate } from '../japanese/fileMatching';
const CATALOG = 'https://subtitles.ajatt.top/';
export interface CatalogEntry {
  title: string;
  english: string;
  japanese: string;
  url: string;
}
export function parseCatalog(html: string): CatalogEntry[] {
  const entries: CatalogEntry[] = [];
  for (const row of html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...row[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map((m) => m[1]);
    const anchor = cells[1]?.match(/<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
    if (!anchor) continue;
    const url = new URL(plainText(anchor[1]), CATALOG);
    if (
      url.origin !== new URL(CATALOG).origin ||
      !/^\/anime_(tv|movie)\/[^/]+\.html$/.test(url.pathname)
    )
      continue;
    entries.push({
      title: plainText(anchor[2]),
      english: plainText(cells[3] ?? ''),
      japanese: plainText(cells[4] ?? ''),
      url: url.href,
    });
  }
  return entries;
}
export class KitsunekkoProvider implements JapaneseSubtitleProvider {
  id = 'kitsunekko' as const;
  constructor(private signal?: AbortSignal) {}
  private async catalog(signal?: AbortSignal) {
    const key = 'kitsunekko:catalog:v1';
    const cached = await database.get<{ expiresAt: number; entries: CatalogEntry[] }>(key);
    signal?.throwIfAborted();
    if (cached && cached.expiresAt > Date.now()) return cached.entries;
    const entries = parseCatalog(
      new TextDecoder().decode(await request(CATALOG, {}, 7000, signal)),
    );
    if (!entries.length) throw Error('Empty or changed Kitsunekko catalog');
    signal?.throwIfAborted();
    await database.put(key, { entries, expiresAt: Date.now() + 6 * 60 * 60 * 1000 });
    return entries;
  }
  async search(
    c: AnimeContext,
    language: SourceLanguage = 'ja',
    signal = this.signal,
  ): Promise<SubtitleSearchResult[]> {
    if (language !== 'ja') return [];
    const matches = (await this.catalog(signal)).flatMap((entry) => {
      const title = matchedTitle(c, [entry.japanese, entry.title, entry.english]);
      return title ? [{ entry, title }] : [];
    });
    const candidates: SubtitleSearchResult[] = [];
    for (const { entry, title } of matches.slice(0, 3)) {
      const html = new TextDecoder().decode(await request(entry.url, {}, 7000, signal));
      for (const link of htmlSubtitleLinks(html, entry.url)) {
        const url = new URL(link);
        if (
          url.origin !== 'https://raw.githubusercontent.com' ||
          !url.pathname.startsWith('/Ajatt-Tools/kitsunekko-mirror/')
        )
          continue;
        const candidate = japaneseFileCandidate(
          c,
          this.id,
          { title: entry.title, matchedTitle: title },
          { name: fileName(link), url: link },
        );
        if (candidate) candidates.push(candidate);
      }
    }
    return [...new Map(candidates.map((r) => [r.id, r])).values()];
  }
  download(candidate: SubtitleSearchResult, signal = this.signal) {
    const url = publicSubtitleURL(candidate.downloadUrl ?? '');
    if (!url.startsWith('https://raw.githubusercontent.com/Ajatt-Tools/kitsunekko-mirror/'))
      throw Error('Invalid Kitsunekko file host');
    return request(url, {}, 7000, signal, true);
  }
}
