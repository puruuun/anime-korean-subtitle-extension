import { AppError } from './errors';
/** Bound a complete source attempt (search + every resolve/download), not each URL separately. */
export async function withDeadline<T>(
  parent: AbortSignal,
  milliseconds: number,
  run: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  parent.throwIfAborted();
  const controller = new AbortController();
  const abort = () => controller.abort(parent.reason);
  parent.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(
    () => controller.abort(new AppError('TIMEOUT', '자막 검색 시간이 초과되었습니다.')),
    milliseconds,
  );
  let listener: (() => void) | undefined;
  const interrupted = new Promise<never>((_resolve, reject) => {
    listener = () => reject(controller.signal.reason);
    controller.signal.addEventListener('abort', listener, { once: true });
  });
  try {
    return await Promise.race([run(controller.signal), interrupted]);
  } finally {
    clearTimeout(timer);
    parent.removeEventListener('abort', abort);
    if (listener) controller.signal.removeEventListener('abort', listener);
  }
}
