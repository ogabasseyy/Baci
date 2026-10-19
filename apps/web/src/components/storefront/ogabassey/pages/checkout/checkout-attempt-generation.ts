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

/**
 * In-memory fallback engaged only when sessionStorage persistence throws
 * (for example Safari private browsing). Without it a failed write would be
 * silently dropped and the next rotation would re-read the stale stored
 * value, repeating an attempt generation.
 */
let memoryGeneration: number | null = null;

function readStoredGeneration(): number | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.sessionStorage.getItem(
      CHECKOUT_ATTEMPT_GENERATION_KEY
    );
    if (raw === null) return 0;
    const parsed = Number.parseInt(raw, 10);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
  } catch {
    return null;
  }
}

function writeStoredGeneration(generation: number): boolean {
  try {
    window.sessionStorage.setItem(
      CHECKOUT_ATTEMPT_GENERATION_KEY,
      String(generation)
    );
    return true;
  } catch {
    return false;
  }
}

export function readCheckoutAttemptGeneration(): number {
  if (memoryGeneration !== null) return memoryGeneration;
  return readStoredGeneration() ?? 0;
}

export function rotateCheckoutAttemptGeneration(): number {
  const next = readCheckoutAttemptGeneration() + 1;
  // Server-side rotation has no per-request store; return without engaging
  // the module-level fallback so concurrent requests cannot share state.
  if (typeof window === 'undefined') return next;
  if (writeStoredGeneration(next)) {
    memoryGeneration = null;
  } else {
    memoryGeneration = next;
  }
  return next;
}
