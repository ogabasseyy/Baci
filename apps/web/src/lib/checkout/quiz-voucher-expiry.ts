/**
 * Client-safe reader for the NON-SECRET `expiresAt` claim inside a quiz
 * voucher token (`qv1.<base64url-body>.<signature>`). The HMAC signature is a
 * server-only concern and is deliberately NOT verified here — this only decodes
 * the plaintext body so the cart can prune a voucher line that has passed its
 * 7-day window before it re-fails every checkout.
 */

interface CartLineWithVoucher {
  quizAwardId?: string;
  quizVoucherToken?: string;
}

function decodeBase64Url(value: string): string {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=');

  if (typeof atob === 'function') {
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, (character) =>
      character.charCodeAt(0)
    );
    return new TextDecoder().decode(bytes);
  }

  // Node/SSR fallback (e.g. Vitest without jsdom globals). Access via
  // globalThis indirection so client bundlers do not inject the Node `buffer`
  // polyfill (~34 KiB) into storefront chunks.
  const nodeBuffer = (
    globalThis as {
      Buffer?: {
        from(
          input: string,
          encoding: string
        ): { toString(encoding: string): string };
      };
    }
  ).Buffer;
  return nodeBuffer ? nodeBuffer.from(padded, 'base64').toString('utf8') : '';
}

/**
 * Returns the token's expiry in epoch-ms, or null if the token is malformed or
 * carries no readable expiry (in which case callers should fail open and let
 * the server validate).
 */
export function readQuizVoucherExpiry(token: string): number | null {
  const [, body] = token.split('.');
  if (!body) return null;

  try {
    const parsed = JSON.parse(decodeBase64Url(body)) as { expiresAt?: unknown };
    if (typeof parsed.expiresAt !== 'string') return null;
    const expiresAtMs = Date.parse(parsed.expiresAt);
    return Number.isFinite(expiresAtMs) ? expiresAtMs : null;
  } catch {
    return null;
  }
}

/** True only when the token has a readable expiry that is already in the past. */
export function isQuizVoucherTokenExpired(
  token: string,
  now: number = Date.now()
): boolean {
  const expiresAtMs = readQuizVoucherExpiry(token);
  if (expiresAtMs === null) return false;
  return now > expiresAtMs;
}

/**
 * Drops voucher-backed cart lines whose token has expired. Non-voucher lines
 * and voucher lines with an unreadable/future expiry are preserved unchanged.
 */
export function pruneExpiredVoucherCartLines<T extends CartLineWithVoucher>(
  cart: T[],
  now: number = Date.now()
): T[] {
  return cart.filter((item) => {
    if (!item.quizAwardId || !item.quizVoucherToken) return true;
    return !isQuizVoucherTokenExpired(item.quizVoucherToken, now);
  });
}
