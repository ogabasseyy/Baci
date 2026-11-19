// Deliberately partial: only dial-level failures that prove nothing was sent.
// ETIMEDOUT, ECONNRESET and EPIPE can happen after the request left, so those
// stay locked (fail safe against double booking).
const NEVER_REACHED_CODES = new Set([
  'ECONNREFUSED',
  'ENOTFOUND',
  'EAI_AGAIN',
  'ENETUNREACH',
  'EHOSTUNREACH',
]);

/** Errors the provider-call boundary proved never opened a connection. */
const providerNeverReachedErrors = new WeakSet<object>();

function hasNeverReachedCause(error: unknown): boolean {
  // Node's fetch wraps the system error in `cause`, sometimes one level deeper.
  let current: unknown = error;
  for (
    let depth = 0;
    depth < 3 && typeof current === 'object' && current !== null;
    depth += 1
  ) {
    const { code, cause } = current as {
      code?: unknown;
      cause?: unknown;
    };
    if (typeof code === 'string' && NEVER_REACHED_CODES.has(code)) return true;
    current = cause;
  }
  return false;
}

/**
 * Tag an error thrown by the provider booking call itself. Only tagged errors
 * count as "never reached": a database or other connection failure that
 * happens after the carrier booked the parcel must keep the lock.
 */
export function tagProviderCallError(error: unknown): void {
  if (
    typeof error === 'object' &&
    error !== null &&
    hasNeverReachedCause(error)
  ) {
    providerNeverReachedErrors.add(error);
  }
}

/** True when the provider-call boundary proved the connection never opened. */
export function isProviderNeverReachedError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    providerNeverReachedErrors.has(error)
  );
}
