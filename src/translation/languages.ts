export interface TargetLanguagePreset {
  code: string;
  label: string;
  englishName: string;
}

export const TARGET_LANGUAGES: readonly TargetLanguagePreset[] = [
  { code: 'ko', label: '한국어', englishName: 'Korean' },
  { code: 'en', label: 'English', englishName: 'English' },
  { code: 'ja', label: '日本語', englishName: 'Japanese' },
  { code: 'zh-CN', label: '中文(简体)', englishName: 'Simplified Chinese' },
  { code: 'zh-TW', label: '中文(繁體)', englishName: 'Traditional Chinese' },
  { code: 'es', label: 'Español', englishName: 'Spanish' },
  { code: 'fr', label: 'Français', englishName: 'French' },
  { code: 'de', label: 'Deutsch', englishName: 'German' },
  { code: 'pt', label: 'Português', englishName: 'Portuguese' },
  { code: 'vi', label: 'Tiếng Việt', englishName: 'Vietnamese' },
  { code: 'th', label: 'ไทย', englishName: 'Thai' },
  { code: 'id', label: 'Bahasa Indonesia', englishName: 'Indonesian' },
] as const;

export const DEFAULT_TARGET_LANGUAGE = 'ko';

const BCP47_SHORT_RE = /^[a-z]{2,3}(?:-[A-Za-z0-9]{2,4})?$/i;

function findPreset(code: string): TargetLanguagePreset | undefined {
  const lower = code.toLowerCase();
  return TARGET_LANGUAGES.find((lang) => lang.code.toLowerCase() === lower);
}

export function isValidTargetLanguage(code: unknown): boolean {
  if (typeof code !== 'string') return false;
  const trimmed = code.trim();
  if (!trimmed) return false;
  return Boolean(findPreset(trimmed)) || BCP47_SHORT_RE.test(trimmed);
}

export function normalizeTargetLanguage(code?: unknown): string {
  if (typeof code !== 'string') return DEFAULT_TARGET_LANGUAGE;
  const trimmed = code.trim();
  if (!trimmed) return DEFAULT_TARGET_LANGUAGE;
  const preset = findPreset(trimmed);
  if (preset) return preset.code;
  if (!BCP47_SHORT_RE.test(trimmed)) return DEFAULT_TARGET_LANGUAGE;
  const [primary, region] = trimmed.split('-');
  return region ? `${primary.toLowerCase()}-${region.toUpperCase()}` : primary.toLowerCase();
}

export function languageLabel(code: string): string {
  const normalized = normalizeTargetLanguage(code);
  return findPreset(normalized)?.label ?? (code.trim() || DEFAULT_TARGET_LANGUAGE);
}

export function languagePromptName(code: string): string {
  const trimmed = code.trim();
  if (!trimmed) return findPreset(DEFAULT_TARGET_LANGUAGE)!.englishName;
  const preset = findPreset(trimmed);
  if (preset) return preset.englishName;
  return isValidTargetLanguage(trimmed) ? normalizeTargetLanguage(trimmed) : trimmed;
}

export function sameBaseLanguage(a?: string, b?: string): boolean {
  if (!a || !b) return false;
  const na = a.trim().replace(/_/g, '-').toLowerCase();
  const nb = b.trim().replace(/_/g, '-').toLowerCase();
  if (!na || !nb) return false;
  if (na === nb) return true;
  const baseA = na.split('-')[0];
  const baseB = nb.split('-')[0];
  if (baseA !== baseB) return false;
  // Keep Chinese script/region variants (e.g. zh-CN vs zh-TW) distinct.
  if (baseA === 'zh') return false;
  return true;
}
