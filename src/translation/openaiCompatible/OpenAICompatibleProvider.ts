import { completionText } from '../completionResponse';
import type { Settings } from '../../storage/settings';
import type {
  TranslationCue,
  TranslationOptions,
  TranslationProvider,
  TranslatedCue,
} from '../TranslationProvider';
import { validateTranslations } from '../TranslationProvider';
import { systemPrompt, translationSchema } from '../prompts';
import { request, requestJSON } from '../../background/network';
import { AppError } from '../../utils/errors';
export class OpenAICompatibleProvider implements TranslationProvider {
  id = 'openai';
  constructor(protected config: Settings['translation']) {}
  async translate(cues: TranslationCue[], options: TranslationOptions): Promise<TranslatedCue[]> {
    if (!this.config.model.trim()) throw new AppError('MODEL', 'Settings에서 Model을 입력하세요.');
    const format =
      this.config.structured === 'json_schema'
        ? {
            type: 'json_schema',
            json_schema: { name: 'subtitle_translation', strict: true, schema: translationSchema },
          }
        : this.config.structured === 'json_object'
          ? { type: 'json_object' }
          : undefined;
    const response = await request(
      this.config.baseUrl.replace(/\/$/, '') + '/chat/completions',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(this.config.apiKey ? { Authorization: 'Bearer ' + this.config.apiKey } : {}),
        },
        body: JSON.stringify({
          model: this.config.model,
          temperature: this.config.temperature,
          messages: [
            { role: 'system', content: systemPrompt(options.sourceLanguage) },
            {
              role: 'user',
              content: JSON.stringify({
                previousContext: options.previousContext,
                previousTranslations: options.previousTranslations ?? [],
                toTranslate: cues.map(({ id, text }) => ({ id, text })),
              }),
            },
          ],
          ...(format ? { response_format: format } : {}),
          stream: true,
        }),
      },
      this.config.timeoutMs,
      options.signal,
    );
    const content = completionText(new TextDecoder().decode(response));
    if (!content)
      throw new AppError(
        'TRANSLATION_FORMAT',
        '번역 응답이 비어 있거나 잘렸습니다. Chunk Size를 줄이세요.',
        true,
      );
    try {
      return validateTranslations(cues, JSON.parse(content));
    } catch {
      throw new AppError(
        'TRANSLATION_FORMAT',
        '번역 응답 형식이 잘못되었습니다. Cue 개수와 ID가 일치해야 합니다.',
        true,
      );
    }
  }
  async testConnection(signal?: AbortSignal) {
    const result = await requestJSON<{ data?: { id: string }[] }>(
      this.config.baseUrl.replace(/\/$/, '') + '/models',
      { headers: this.config.apiKey ? { Authorization: 'Bearer ' + this.config.apiKey } : {} },
      Math.min(this.config.timeoutMs, 20000),
      signal,
    );
    const models = result.data?.map((x) => x.id) ?? [];
    if (!models.length)
      throw new AppError('MODEL', '사용 가능한 모델이 없습니다. 모델 서버에서 모델을 로드하세요.');
    if (this.config.model && !models.includes(this.config.model))
      throw new AppError('MODEL', '모델을 찾을 수 없습니다. Model ID를 확인하세요.');
    return models;
  }
}
