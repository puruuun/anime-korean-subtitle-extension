// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { MiruroAdapter } from '../src/sites/miruro/MiruroAdapter';
import { miruroContext } from '../src/sites/miruro/metadata';
import { reanimeContext } from '../src/sites/reanime/metadata';
import { normalizeTitle } from '../src/anime/titleNormalizer';
describe('observed site metadata', () => {
  it('Miruro uses observed anime-title and ep query', () => {
    document.head.innerHTML = '';
    document.body.innerHTML = '<h1 class="title anime-title">Frieren</h1>';
    expect(miruroContext(document, 'https://www.miruro.to/watch/frieren?ep=7').episode).toBe(7);
  });
  it('Miruro matches miruro.to, miruro.tv, and miruro.online and parses miruro.tv title and JSON-LD', () => {
    const adapter = new MiruroAdapter();
    expect(adapter.matches('https://www.miruro.to/watch/test?ep=1')).toBe(true);
    expect(adapter.matches('https://miruro.tv/watch/abc/the-apothecary-diaries-season-3?ep=1')).toBe(true);
    expect(adapter.matches('https://www.miruro.online/watch/test?ep=1')).toBe(true);
    expect(adapter.matches('https://notmiruro.tv/watch/test?ep=1')).toBe(false);

    document.body.innerHTML = '<h1>Locusts</h1>';
    document.head.innerHTML =
      '<script type="application/ld+json">' +
      JSON.stringify({
        '@type': 'TVSeries',
        name: 'The Apothecary Diaries Season 3',
        image: 'https://s4.anilist.co/file/anilistcdn/media/anime/banner/195516-B5M0cPaQbQXI.jpg',
      }) +
      '</script>';
    document.title = 'Watch The Apothecary Diaries Season 3 - Miruro';
    expect(
      miruroContext(
        document,
        'https://miruro.tv/watch/8rVxkkxRnGt12LItY2fnNEh1k1E7mmbA/the-apothecary-diaries-season-3?ep=1',
      ),
    ).toMatchObject({
      site: 'miruro',
      title: 'The Apothecary Diaries Season 3',
      episode: 1,
      season: 3,
      anilistId: 195516,
    });

    document.head.innerHTML = '';
    document.title = 'Watch The Apothecary Diaries Season 3 - Miruro';
    expect(
      miruroContext(
        document,
        'https://miruro.tv/watch/8rVxkkxRnGt12LItY2fnNEh1k1E7mmbA/the-apothecary-diaries-season-3?ep=2',
      ),
    ).toMatchObject({
      site: 'miruro',
      title: 'The Apothecary Diaries Season 3',
      episode: 2,
      season: 3,
    });
  });
  it('ReANIME uses TVEpisode JSON-LD, preferring current URL on SPA navigation', () => {
    document.head.innerHTML =
      '<script type="application/ld+json">' +
      JSON.stringify({
        '@type': 'TVEpisode',
        episodeNumber: '1',
        partOfSeries: { name: 'Naruto' },
      }) +
      '</script>';
    expect(reanimeContext(document, 'https://reanime.to/watch/naruto-bjfend?ep=2')).toMatchObject({
      title: 'Naruto',
      episode: 2,
    });
    expect(
      reanimeContext(
        document,
        'https://reanime.cz/watch/blue-box-season-2-3m552p?ep=1&lang=sub&server=HD-2',
      ),
    ).toMatchObject({
      site: 'reanime',
      title: 'Naruto',
      episode: 1,
    });
  });
  it('does not invent episode 1', () => {
    expect(() => miruroContext(document, 'https://www.miruro.to/watch/frieren')).toThrow('회차');
  });
  it('normalizes season, part and episode labels', () => {
    expect(normalizeTitle('Frieren: S02 Part 2 Episode 12')).toBe('frieren');
  });
});
