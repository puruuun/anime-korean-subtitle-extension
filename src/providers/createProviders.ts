import type { Settings } from '../storage/settings';
import { SubDLProvider } from './subdl/SubDLProvider';
import { OpenSubtitlesProvider } from './opensubtitles/OpenSubtitlesProvider';
import { AnissiaProvider } from './anissia/AnissiaProvider';
export function createProviders(s: Settings, signal?: AbortSignal) {
  return [
    new AnissiaProvider(signal),
    ...Object.entries(s.providers)
      .filter(([, v]) => v.enabled && v.apiKey.trim())
      .sort(([, a], [, b]) => a.priority - b.priority)
      .map(([id]) =>
        id === 'subdl'
          ? new SubDLProvider(s.providers.subdl.apiKey, signal)
          : new OpenSubtitlesProvider(s.providers.opensubtitles, signal),
      ),
  ];
}
