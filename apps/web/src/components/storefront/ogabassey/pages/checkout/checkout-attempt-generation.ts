/**
 * Session-persisted checkout attempt generation.
 *
 * The checkout_started session dedupe must tell repeat purchases apart even
 * when the cart is identical and the page remounts with the same React tree
 * (React useId is deterministic per tree, so it cannot serve as the attempt
 * identity). This counter rotates after every created order, so each checkout
 * attempt gets a fresh generation while reloads mid-attempt keep theirs.
 */

const CHECKOUT_ATTEMPT_GENERATION_KEY = 'baci:checkout-attempt-generation';

function readStoredGeneration(): number {
  if (typeof window === 'undefined') return 0;
  try {
    const raw = window.sessionStorage.getItem(
      CHECKOUT_ATTEMPT_GENERATION_KEY
    );
    const parsed = raw === null ? 0 : Number.parseInt(raw, 10);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
  } catch {
    return 0;
  }
}

function writeStoredGeneration(generation: number): void {
  try {
    window.sessionStorage.setItem(
      CHECKOUT_ATTEMPT_GENERATION_KEY,
      String(generation)
    );
  } catch {
    // Storage unavailable: callers fall back to the in-memory generation.
  }
}

export function readCheckoutAttemptGeneration(): number {
  return readStoredGeneration();
}

export function rotateCheckoutAttemptGeneration(): number {
  const next = readStoredGeneration() + 1;
  writeStoredGeneration(next);
  return next;
}
