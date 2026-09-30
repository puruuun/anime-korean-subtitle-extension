export async function retry<T>(
  action: () => Promise<T>,
  count: number,
  signal?: AbortSignal,
  shouldRetry: (e: unknown) => boolean = () => true,
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    signal?.throwIfAborted();
    try {
      return await action();
    } catch (e) {
      if (attempt >= count || !shouldRetry(e) || signal?.aborted) throw e;
      await new Promise<void>((resolve, reject) => {
        const onAbort = () => {
          clearTimeout(timer);
          reject(signal?.reason);
        };
        const timer = setTimeout(
          () => {
            signal?.removeEventListener('abort', onAbort);
            resolve();
          },
          Math.min(500 * 2 ** attempt, 4000),
        );
        signal?.addEventListener('abort', onAbort, { once: true });
      });
    }
  }
}
