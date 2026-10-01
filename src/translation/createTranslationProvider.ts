import type { Settings } from '../storage/settings';
import { LMStudioProvider } from './lmstudio/LMStudioProvider';
import { GeminiProvider } from './gemini/GeminiProvider';
export function createTranslationProvider(config: Settings['translation']) {
  return config.provider === 'gemini' ? new GeminiProvider(config) : new LMStudioProvider(config);
}
