import type { Settings } from '../../storage/settings';
import type {
  TranslationProvider,
  TranslationCue,
  TranslationOptions,
  TranslatedCue,
} from '../TranslationProvider';
import { validateTranslations } from '../TranslationProvider';
import { systemPrompt, translationSchema } from '../prompts';
import { requestJSON } from '../../background/network';
import { AppError } from '../../utils/errors';
export class GeminiProvider implements TranslationProvider {
  id = 'gemini';
  constructor(private config: Settings['translation']) {}
  private headers() {
    if (!this.config.geminiApiKey.trim())
      throw new AppError('CONFIG', 'Settings에서 Gemini API Key를 입력하세요.');
    return {
      'Content-Type': 'application/json',
      'x-goog-api-key': this.config.geminiApiKey.trim(),
    };
  }
  async translate(cues: TranslationCue[], options: TranslationOptions): Promise<TranslatedCue[]> {
    const model = this.config.geminiModel.replace(/^models\//, '').trim();
    if (!/^[\w.-]+$/.test(model))
      throw new AppError('MODEL', 'Settings에서 Gemini Model ID를 입력하세요.');
    const response = await requestJSON<{
      candidates?: {
        finishReason?: string;
        content?: { parts?: { text?: string; thought?: boolean }[] };
      }[];
    }>(
      'https://generativelanguage.googleapis.com/v1beta/models/' +
        encodeURIComponent(model) +
        ':generateContent',
      {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: systemPrompt(options.sourceLanguage) }] },
          contents: [
            {
              role: 'user',
              parts: [
                {
                  text: JSON.stringify({
                    previousContext: options.previousContext,
                    previousTranslations: options.previousTranslations ?? [],
                    toTranslate: cues.map(({ id, text }) => ({ id, text })),
                  }),
                },
              ],
            },
          ],
          generationConfig: {
            temperature: this.config.temperature,
            responseMimeType: 'application/json',
            responseJsonSchema: translationSchema,
          },
        }),
      },
      this.config.timeoutMs,
      options.signal,
    );
    const candidate = response.candidates?.[0];
    if (!candidate || candidate.finishReason !== 'STOP')
      throw new AppError(
        'TRANSLATION_FORMAT',
        'Gemini 번역 응답이 비어 있거나 완료되지 않았습니다.',
        true,
      );
    const text =
      candidate.content?.parts
        ?.filter((p) => !p.thought)
        .map((p) => p.text ?? '')
        .join('') ?? '';
    try {
      return validateTranslations(cues, JSON.parse(text));
    } catch {
      throw new AppError(
        'TRANSLATION_FORMAT',
        'Gemini 번역 Cue 개수와 ID가 일치해야 합니다.',
        true,
      );
    }
  }
  async testConnection(signal?: AbortSignal): Promise<string[]> {
    const result = await requestJSON<{
      models?: { name: string; supportedGenerationMethods?: string[] }[];
    }>(
      'https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000',
      { headers: this.headers() },
      15000,
      signal,
    );
    const models =
      result.models
        ?.filter((m) => m.supportedGenerationMethods?.includes('generateContent'))
        .map((m) => m.name.replace(/^models\//, '')) ?? [];
    if (!models.length) throw new AppError('MODEL', '사용 가능한 Gemini 모델이 없습니다.');
    if (
      this.config.geminiModel &&
      !models.includes(this.config.geminiModel.replace(/^models\//, ''))
    )
      throw new AppError('MODEL', 'Gemini Model ID를 확인하세요.');
    return models;
  }
}
