import { afterEach, describe, expect, it, vi } from 'vitest';
import { GeminiProvider } from '../src/translation/gemini/GeminiProvider';
import { defaultSettings } from '../src/storage/settings';
import { translationKey } from '../src/translation/TranslationCache';
import { animeContextTitle, systemPrompt } from '../src/translation/prompts';
const config = {
  ...defaultSettings.translation,
  provider: 'gemini' as const,
  geminiApiKey: 'fake-gemini-key',
  geminiModel: 'test-model',
};
const response = (text: string, reason = 'STOP') =>
  new Response(
    JSON.stringify({ candidates: [{ finishReason: reason, content: { parts: [{ text }] } }] }),
  );
afterEach(() => vi.unstubAllGlobals());
describe('Gemini reuses the translation contract', () => {
  it.each(['ja', 'en'] as const)(
    'translates %s with the language prompt and JSON schema, no time codes or keys in URL',
    async (sourceLanguage) => {
      const fetch = vi.fn(async () => response('{"translations":[{"id":10,"text":"안녕"}]}'));
      vi.stubGlobal('fetch', fetch);
      const cues = [{ id: 10, text: sourceLanguage === 'ja' ? 'こんにちは' : 'Hello' }];
      expect(
        await new GeminiProvider(config).translate(cues, {
          sourceLanguage,
          previousContext: [],
          animeTitle: 'Test Anime',
        }),
      ).toEqual([{ id: 10, text: '안녕' }]);
      const [url, request] = (fetch.mock.calls as unknown as [string, RequestInit][])[0];
      expect(url).toBe(
        'https://generativelanguage.googleapis.com/v1beta/models/test-model:generateContent',
      );
      expect(request.headers).toMatchObject({ 'x-goog-api-key': 'fake-gemini-key' });
      const body = JSON.parse(String(request.body));
      expect(body.systemInstruction.parts[0].text).toBe(systemPrompt(sourceLanguage));
      const payload = JSON.parse(body.contents[0].parts[0].text);
      expect(payload.toTranslate).toEqual(cues);
      expect(payload.animeTitle).toBe('Test Anime');
      expect(payload.previousTranslations).toBeUndefined();
      expect(body.generationConfig.responseJsonSchema.required).toEqual(['translations']);
    },
  );
  it('omits animeTitle when not provided', async () => {
    const fetch = vi.fn(async () => response('{"translations":[{"id":10,"text":"안녕"}]}'));
    vi.stubGlobal('fetch', fetch);
    const cues = [{ id: 10, text: 'Hello' }];
    await new GeminiProvider(config).translate(cues, {
      sourceLanguage: 'en',
      previousContext: [],
    });
    const [, request] = (fetch.mock.calls as unknown as [string, RequestInit][])[0];
    const body = JSON.parse(String(request.body));
    const payload = JSON.parse(body.contents[0].parts[0].text);
    expect(payload.animeTitle).toBeUndefined();
    expect(payload.previousTranslations).toBeUndefined();
  });
  it('formats animeContextTitle deduplicating and trimming titles', () => {
    expect(animeContextTitle()).toBeUndefined();
    expect(
      animeContextTitle({
        koreanTitle: ' 귀멸의 칼날 ',
        title: 'Kimetsu no Yaiba',
        nativeTitle: '鬼滅の刃',
        englishTitle: 'Demon Slayer',
        romajiTitle: 'Kimetsu no Yaiba',
      }),
    ).toBe('귀멸의 칼날 / Kimetsu no Yaiba / 鬼滅の刃 / Demon Slayer');
  });
  it.each(['{"translations":[]}', '{"translations":[{"id":999,"text":"안녕"}]}', 'not JSON'])(
    'rejects malformed or mismatched translation %s',
    async (text) => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => response(text)),
      );
      await expect(
        new GeminiProvider(config).translate([{ id: 10, text: 'Hello' }], {
          sourceLanguage: 'en',
          previousContext: [],
        }),
      ).rejects.toThrow('ID');
    },
  );
  it('rejects incomplete or blocked output and lists usable models', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => response('{"translations":[{"id":10,"text":"안녕"}]}', 'MAX_TOKENS')),
    );
    await expect(
      new GeminiProvider(config).translate([{ id: 10, text: 'Hello' }], {
        sourceLanguage: 'en',
        previousContext: [],
      }),
    ).rejects.toThrow('완료');
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              models: [
                { name: 'models/test-model', supportedGenerationMethods: ['generateContent'] },
                { name: 'models/embed', supportedGenerationMethods: ['embedContent'] },
              ],
            }),
          ),
      ),
    );
    expect(await new GeminiProvider(config).testConnection()).toEqual(['test-model']);
  });
  it('source, hash, translation engine/model and language each separate translation cache entries', async () => {
    const c = {
      site: 'miruro' as const,
      title: 'Show',
      episode: 1,
      pageUrl: 'https://www.miruro.to/watch/show',
    };
    const keys = await Promise.all([
      translationKey(c, 'same', 'ja', config, 'jimaku'),
      translationKey(c, 'same', 'ja', config, 'kitsunekko'),
      translationKey(c, 'changed', 'ja', config, 'jimaku'),
      translationKey(c, 'same', 'ja', { ...config, geminiModel: 'other' }, 'jimaku'),
      translationKey(c, 'same', 'ja', { ...config, provider: 'lmstudio' }, 'jimaku'),
      translationKey(c, 'same', 'en', config, 'embedded-en'),
    ]);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
