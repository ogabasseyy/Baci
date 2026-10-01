function retainTimeout(timeout: ReturnType<typeof setTimeout>): void {
  if (typeof timeout !== 'object' || !('ref' in timeout)) return;
  timeout.ref();
}

export function settleBuilderAiSmokeBeforeDeadline<T>(
  completion: Promise<T>,
  signal: AbortSignal,
  milliseconds: number
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => finish(new Error('Builder AI smoke deadline exceeded')), milliseconds);
    retainTimeout(timeout);
    const onAbort = () => finish(new Error('Builder AI smoke deadline exceeded'));
    const finish = (error?: Error, value?: T) => {
      clearTimeout(timeout);
      signal.removeEventListener('abort', onAbort);
      if (error) reject(error);
      else resolve(value as T);
    };
    if (signal.aborted) {
      onAbort();
      return;
    }
    signal.addEventListener('abort', onAbort, { once: true });
    completion.then(
      (value) => finish(undefined, value),
      (error: unknown) => finish(error instanceof Error ? error : new Error('Builder AI smoke failed'))
    );
  });
}
