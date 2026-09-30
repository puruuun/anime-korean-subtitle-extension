import { describe, it, expect, vi, afterEach } from 'vitest';
import { SubDLProvider } from '../src/providers/subdl/SubDLProvider';
import { OpenSubtitlesProvider } from '../src/providers/opensubtitles/OpenSubtitlesProvider';
import { defaultSettings } from '../src/storage/settings';
const c = {
  site: 'miruro' as const,
  title: 'Frieren',
  episode: 7,
  season: 1,
  pageUrl: 'https://www.miruro.to/watch/x?ep=7',
};
afterEach(() => vi.unstubAllGlobals());
describe('documented provider mappings', () => {
  it('SubDL maps unpacked episode files, not a season pack', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response(
            JSON.stringify({
              status: true,
              results: [{ name: 'Frieren' }],
              subtitles: [
                {
                  url: '/subtitle/pack.zip',
                  full_season: true,
                  unpack_files: [
                    {
                      name: 'Frieren.E07.srt',
                      language: 'KO',
                      episode: 7,
                      season: 1,
                      url: '/subtitle/pack/file7',
                    },
                  ],
                },
              ],
            }),
            { headers: { 'Content-Type': 'application/json' } },
          ),
        ),
    );
    const r = await new SubDLProvider('test').search(c, 'ko');
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({
      episode: 7,
      season: 1,
      downloadUrl: 'https://dl.subdl.com/subtitle/pack/file7',
    });
  });
  it('OpenSubtitles maps parent identifiers and file IDs', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response(
            JSON.stringify({
              data: [
                {
                  id: '1',
                  attributes: {
                    language: 'ja',
                    feature_details: {
                      parent_title: 'Frieren',
                      parent_imdb_id: 1234567,
                      parent_tmdb_id: 9,
                      episode_number: 7,
                      season_number: 1,
                    },
                    files: [{ file_id: 77, file_name: 'Frieren.E07.srt' }],
                  },
                },
              ],
            }),
          ),
        ),
    );
    const r = await new OpenSubtitlesProvider({
      ...defaultSettings.providers.opensubtitles,
      apiKey: 'test',
    }).search(c, 'ja');
    expect(r[0]).toMatchObject({ fileId: 77, imdbId: 'tt1234567', episode: 7, tmdbId: 9 });
  });
});
