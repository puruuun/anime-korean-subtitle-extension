export interface TranslationCue {
  id: number;
  text: string;
}
export interface TranslatedCue {
  id: number;
  text: string;
}
export interface TranslationOptions {
  sourceLanguage: 'ja' | 'en';
  previousContext: TranslationCue[];
  previousTranslations?: TranslatedCue[];
  signal?: AbortSignal;
}
export interface TranslationProvider {
  id: string;
  translate(cues: TranslationCue[], options: TranslationOptions): Promise<TranslatedCue[]>;
}
export function validateTranslations(cues: TranslationCue[], raw: unknown): TranslatedCue[] {
  const values = Array.isArray(raw)
    ? raw
    : raw && typeof raw === 'object' && 'translations' in raw
      ? (raw as { translations: unknown }).translations
      : undefined;
  if (!Array.isArray(values) || values.length !== cues.length)
    throw Error('번역 Cue 개수가 일치하지 않습니다.');
  const source = new Set(cues.map((c) => c.id)),
    seen = new Set<number>();
  const byId = new Map<number, string>();
  for (const item of values) {
    if (
      !item ||
      typeof item !== 'object' ||
      !Number.isInteger(item.id) ||
      !source.has(item.id) ||
      seen.has(item.id) ||
      typeof item.text !== 'string' ||
      !item.text.trim()
    )
      throw Error('번역 ID 누락·중복 또는 빈 번역이 있습니다.');
    seen.add(item.id);
    byId.set(item.id, item.text.trim());
  }
  return cues.map((c) => ({ id: c.id, text: byId.get(c.id)! }));
}
