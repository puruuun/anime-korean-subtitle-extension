export class AppError extends Error {
  constructor(
    public code: string,
    message: string,
    public retryable = false,
  ) {
    super(message);
    this.name = 'AppError';
  }
}
export const errorText = (e: unknown) =>
  e instanceof AppError
    ? e.message
    : e instanceof Error && e.name === 'AbortError'
      ? '작업이 취소되었습니다.'
      : '요청을 처리하지 못했습니다. 연결 및 설정을 확인하세요.';
