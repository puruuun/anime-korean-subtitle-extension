// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { detectEmbedded, englishLanguage } from '../src/content/subtitleSources';
describe('embedded subtitle detection', () => {
  it('extracts English track and skips Japanese', async () => {
    document.body.innerHTML =
      '<video><track src="https://cdn.example/en.vtt" srclang="en" label="English"><track src="https://cdn.example/ja.vtt" srclang="ja"></video>';
    const sources = await detectEmbedded();
    expect(sources.filter((s) => s.kind === 'file').map((s) => s.url)).toEqual([
      'https://cdn.example/en.vtt',
    ]);
  });
  it('recognizes English CC labels', () => {
    expect(englishLanguage('English - CC')).toBe(true);
    expect(englishLanguage('ja')).toBe(false);
  });
});
