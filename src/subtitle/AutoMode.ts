import { AppError } from '../utils/errors';
export async function autoMode<T>(
  korean: () => Promise<T>,
  japanese: () => Promise<T>,
  english: () => Promise<T>,
  status: (message: string) => void,
): Promise<T> {
  try {
    return await korean();
  } catch (e) {
    if (!(e instanceof AppError) || e.code !== 'NOT_FOUND') throw e;
    status('한국어 자막 없음 · 일본어 자막을 검색합니다.');
  }
  try {
    return await japanese();
  } catch (e) {
    if (!(e instanceof AppError) || e.code !== 'NOT_FOUND') throw e;
    status('일본어 자막 없음 · 사이트 영어 자막을 사용합니다.');
  }
  return english();
}
