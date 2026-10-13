/**
 * Races a promise against a timer: resolves/rejects with the promise
 * when it settles first, otherwise rejects with `message` after
 * `timeoutMs`. The timer always clears (no leaks on either path).
 * Uses only Promise.race + setTimeout, so it is Hermes-safe and
 * works below the safari 15.4 floor (no AbortSignal.any/.timeout).
 *
 * Primary use (Codex R68 6rwg9A): bounding `response.json()` body
 * reads. Fetch helpers resolve on headers and clear their timer, so
 * a stalled body would otherwise hang the caller indefinitely.
 */
export async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message = 'Operation timed out'
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
