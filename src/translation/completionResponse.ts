import { AppError } from '../utils/errors';
export function completionText(raw: string): string {
  if (!/^\s*(?:data:|event:|:)/.test(raw)) {
    try {
      const r = JSON.parse(raw);
      if (r.choices?.[0]?.finish_reason === 'length')
        throw new AppError(
          'TRANSLATION_FORMAT',
          '번역 응답이 잘렸습니다. Chunk Size를 줄이세요.',
          true,
        );
      const text = r.choices?.[0]?.message?.content;
      if (typeof text !== 'string' || !text.trim())
        throw new AppError('TRANSLATION_FORMAT', '번역 응답이 비어 있습니다.', true);
      return text;
    } catch (e) {
      if (e instanceof AppError) throw e;
      throw new AppError('TRANSLATION_FORMAT', '번역 응답 형식이 잘못되었습니다.', true);
    }
  }
  let text = '',
    done = false;
  for (const line of raw.split(/\r?\n/)) {
    if (!line.startsWith('data:')) continue;
    const data = line.slice(5).trim();
    if (data === '[DONE]') {
      done = true;
      continue;
    }
    try {
      const r = JSON.parse(data);
      if (r.error) throw new AppError('TRANSLATION_API', '번역 중 API 오류가 발생했습니다.', true);
      const choice = r.choices?.[0];
      if (choice?.finish_reason === 'length')
        throw new AppError(
          'TRANSLATION_FORMAT',
          '번역 응답이 잘렸습니다. Chunk Size를 줄이세요.',
          true,
        );
      if (choice?.finish_reason === 'stop') done = true;
      const part = choice?.delta?.content;
      if (typeof part === 'string') text += part;
    } catch (e) {
      if (e instanceof AppError) throw e;
      throw new AppError('TRANSLATION_FORMAT', '번역 스트리밍 응답이 잘못되었습니다.', true);
    }
  }
  if (!text.trim() || !done)
    throw new AppError('TRANSLATION_FORMAT', '번역 스트림이 완료되지 않았습니다.', true);
  return text;
}
