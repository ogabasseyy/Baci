import type { EnsureCartResult } from './shared-cart-hook-support';

/** Longest a host-facing cart request waits for the initial cart adoption. */
export const CART_ADOPTION_WAIT_MS = 10_000;
const POLL_INTERVAL_MS = 25;

const CART_ADOPTION_UNSETTLED: EnsureCartResult = {
  code: 'temporarily_unavailable',
  ok: false,
  retryable: true,
};

/**
 * Resolves true once the initial cart adoption has produced an outcome, or
 * false when the fence closes or the bounded wait runs out. Adoption reports
 * through a ref, so this polls it rather than subscribing.
 */
function waitForCartAdoption(
  outcomeRef: { current: string },
  isLive: () => boolean,
  timeoutMs: number = CART_ADOPTION_WAIT_MS
): Promise<boolean> {
  return new Promise((resolve) => {
    const deadline = Date.now() + timeoutMs;
    const check = () => {
      if (outcomeRef.current !== 'unknown') return resolve(true);
      if (!isLive() || Date.now() >= deadline) return resolve(false);
      setTimeout(check, POLL_INTERVAL_MS);
    };
    check();
  });
}

/**
 * The widget can ask for a cart session before the initial cart read settles.
 * Wait for it (bounded) and rerun the request instead of denying a visitor
 * whose cookie is still valid. Closed fences answer null; a timeout is the
 * same retryable failure as before.
 */
export async function resolveUnsettledCartAdoption(
  outcomeRef: { current: string },
  isLive: () => boolean,
  rerun: () => Promise<EnsureCartResult>,
  timeoutMs?: number
): Promise<EnsureCartResult> {
  const settled = await waitForCartAdoption(outcomeRef, isLive, timeoutMs);
  if (!isLive()) return null;
  return settled ? rerun() : CART_ADOPTION_UNSETTLED;
}
