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

export function hasNeverReachedCause(error: unknown): boolean {
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
