import { describe, it, expect, vi, afterEach } from 'vitest';
import { request, publicSubtitleURL } from '../src/background/network';
import { OpenAICompatibleProvider } from '../src/translation/openaiCompatible/OpenAICompatibleProvider';
import { defaultSettings } from '../src/storage/settings';
afterEach(() => vi.unstubAllGlobals());
describe('background-only network behavior', () => {
  it('handles unreachable model without hanging', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('secret URL and credentials')));
    await expect(
      new OpenAICompatibleProvider(defaultSettings.translation).testConnection(),
    ).rejects.toThrow('연결');
  });
  it('redacts upstream HTTP bodies and rejects nonpublic subtitle addresses', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('API_SECRET', { status: 401 })));
    await expect(request('https://example.com')).rejects.toThrow('인증');
    for (const url of [
      'http://localhost/secret',
      'https://127.0.0.1/s.vtt',
      'https://10.0.0.1/s.vtt',
      'file:///secret',
    ])
      expect(() => publicSubtitleURL(url)).toThrow();
  });
});
