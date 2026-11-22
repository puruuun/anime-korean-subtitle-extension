import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TARGET_LANGUAGE,
  TARGET_LANGUAGES,
  isValidTargetLanguage,
  languageLabel,
  languagePromptName,
  normalizeTargetLanguage,
  sameBaseLanguage,
} from '../src/translation/languages';

describe('target language helpers', () => {
  it('normalizes presets case-insensitively and BCP-47 tags', () => {
    expect(TARGET_LANGUAGES.length).toBe(12);
    expect(normalizeTargetLanguage()).toBe(DEFAULT_TARGET_LANGUAGE);
    expect(normalizeTargetLanguage('  EN  ')).toBe('en');
    expect(normalizeTargetLanguage('zh-cn')).toBe('zh-CN');
    expect(normalizeTargetLanguage('ZH-tw')).toBe('zh-TW');
    expect(normalizeTargetLanguage('pt-br')).toBe('pt-BR');
    expect(normalizeTargetLanguage('IT')).toBe('it');
    expect(normalizeTargetLanguage('invalid_lang!')).toBe(DEFAULT_TARGET_LANGUAGE);
    expect(normalizeTargetLanguage(123)).toBe(DEFAULT_TARGET_LANGUAGE);
  });

  it('validates target language tags', () => {
    expect(isValidTargetLanguage('ko')).toBe(true);
    expect(isValidTargetLanguage('zh-CN')).toBe(true);
    expect(isValidTargetLanguage('fr-CA')).toBe(true);
    expect(isValidTargetLanguage('')).toBe(false);
    expect(isValidTargetLanguage('   ')).toBe(false);
    expect(isValidTargetLanguage('english-us')).toBe(false);
    expect(isValidTargetLanguage(null)).toBe(false);
  });

  it('returns labels and prompt names for presets and fallback BCP-47 codes', () => {
    expect(languageLabel('ko')).toBe('한국어');
    expect(languageLabel('zh-TW')).toBe('中文(繁體)');
    expect(languageLabel('pt-BR')).toBe('pt-BR');
    expect(languagePromptName('ja')).toBe('Japanese');
    expect(languagePromptName('zh-CN')).toBe('Simplified Chinese');
    expect(languagePromptName('pt-br')).toBe('pt-BR');
  });

  it('compares base languages without conflating Simplified and Traditional Chinese', () => {
    expect(sameBaseLanguage('en-US', 'en')).toBe(true);
    expect(sameBaseLanguage('en_GB', 'en-US')).toBe(true);
    expect(sameBaseLanguage('ko-KR', 'ko')).toBe(true);
    expect(sameBaseLanguage('zh-CN', 'zh-CN')).toBe(true);
    expect(sameBaseLanguage('zh-CN', 'zh-TW')).toBe(false);
    expect(sameBaseLanguage('ja', 'en')).toBe(false);
    expect(sameBaseLanguage(undefined, 'ko')).toBe(false);
  });
});
