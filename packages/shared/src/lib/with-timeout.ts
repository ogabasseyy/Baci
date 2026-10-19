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
 * Prefer {@link withDeadline} for body reads: headers + body share
 * one per-request deadline instead of each restarting the clock
 * (Codex R70 6ryArL).
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

/**
 * Races a promise against one shared wall-clock deadline: the timer
 * gets only the budget REMAINING at call time
 * (`max(deadlineMs - now, 0)`), so a body read after slow headers
 * cannot exceed the attempt's total bound. Callers compute
 * `deadlineMs = Date.now() + BUDGET` once, pass it to the fetch
 * helper's `deadlineMs` option, then wrap the body read here.
 */
export function withDeadline<T>(
  promise: Promise<T>,
  deadlineMs: number,
  message = 'Operation timed out'
): Promise<T> {
  return withTimeout(promise, Math.max(deadlineMs - Date.now(), 0), message);
}
