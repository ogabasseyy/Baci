import { setTimeout as delay } from 'node:timers/promises';

/** Retry only an explicit capacity response within the original call lifetime. */
export async function retryVerifierBusy<T>(
  send: () => Promise<T>,
  busy: T,
  signal: AbortSignal
): Promise<T> {
  const retryUntil = Date.now() + 75_000;
  let result = await send();
  while (result === busy && !signal.aborted) {
    const remaining = retryUntil - Date.now();
    if (remaining <= 0) break;
    await delay(Math.min(2_000, remaining), undefined, { signal }).catch(
      () => undefined
    );
    if (signal.aborted || Date.now() >= retryUntil) break;
    result = await send();
  }
  return result;
}
