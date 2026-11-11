export type BoundedResult<T> =
  | { timedOut: true }
  | { timedOut: false; value: T };

/**
 * Run a lookup against the absolute phase deadline (remaining time is
 * recomputed at call time). The AbortSignal is handed to the query so an
 * outstanding read is cancelled when the deadline expires.
 */
export async function runBounded<T>(
  deadlineMs: number | undefined,
  run: (signal: AbortSignal) => PromiseLike<T>
): Promise<BoundedResult<T>> {
  const remainingMs =
    deadlineMs === undefined ? undefined : deadlineMs - Date.now();
  if (remainingMs !== undefined && remainingMs <= 0) return { timedOut: true };
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve(run(controller.signal)).then((value) => ({
        timedOut: false as const,
        value,
      })),
      new Promise<{ timedOut: true }>((resolve) => {
        if (remainingMs === undefined) return;
        timer = setTimeout(() => {
          controller.abort();
          resolve({ timedOut: true });
        }, remainingMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
