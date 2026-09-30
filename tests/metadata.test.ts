// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { miruroContext } from '../src/sites/miruro/metadata';
import { reanimeContext } from '../src/sites/reanime/metadata';
import { normalizeTitle } from '../src/anime/titleNormalizer';
describe('observed site metadata', () => {
  it('Miruro uses observed anime-title and ep query', () => {
    document.body.innerHTML = '<h1 class="title anime-title">Frieren</h1>';
    expect(miruroContext(document, 'https://www.miruro.to/watch/frieren?ep=7').episode).toBe(7);
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
  });
  it('does not invent episode 1', () => {
    expect(() => miruroContext(document, 'https://www.miruro.to/watch/frieren')).toThrow('회차');
  });
  it('normalizes season, part and episode labels', () => {
    expect(normalizeTitle('Frieren: S02 Part 2 Episode 12')).toBe('frieren');
  });
});
