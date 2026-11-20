import { setTimeout as delay } from 'node:timers/promises';

/** Retry only an explicit capacity response within the original call lifetime. */
export async function retryVerifierBusy<T>(
  send: () => Promise<T>,
  busy: T,
  signal: AbortSignal
): Promise<T> {
  const retryUntil = Date.now() + 75_000;
  let result = await send();
  while (result === busy && Date.now() < retryUntil && !signal.aborted) {
    await delay(2_000, undefined, { signal }).catch(() => undefined);
    if (signal.aborted) break;
    result = await send();
  }
  return result;
}
