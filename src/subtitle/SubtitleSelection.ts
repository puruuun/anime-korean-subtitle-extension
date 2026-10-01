import { AppError } from '../utils/errors';
import type { SubtitleSearchResult, SourceLanguage } from '../providers/SubtitleProvider';
export class SelectionRequired extends AppError {
  constructor(
    public results: SubtitleSearchResult[],
    public language: SourceLanguage,
    message = '회차와 시즌을 확인하고 자막 후보를 선택하세요.',
  ) {
    super('SELECT', message);
  }
}
