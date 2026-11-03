import type { Settings } from '../storage/settings';
import { AnissiaProvider } from './anissia/AnissiaProvider';
import { JimakuProvider } from './jimaku/JimakuProvider';
import { KitsunekkoProvider } from './kitsunekko/KitsunekkoProvider';
import { WebKoreanSubtitleProvider } from './web/WebKoreanSubtitleProvider';

declare const __JIMAKU_API_KEY__: string;
const buildKey = typeof __JIMAKU_API_KEY__ === 'string' ? __JIMAKU_API_KEY__ : '';

export function createProviders(s: Settings, signal?: AbortSignal) {
  return [
    new AnissiaProvider(
      signal,
      undefined,
      undefined,
      undefined,
      new WebKoreanSubtitleProvider(s.googleSearch, signal),
    ),
    new JimakuProvider(s.jimaku.apiKey.trim() || buildKey, signal),
    new KitsunekkoProvider(signal),
  ];
}
