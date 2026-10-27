import {
  CART_CLIENT_CREDENTIAL_HEADER,
  isValidCartClientCredential,
} from '@baci/shared/cart';

const STORAGE_KEY = 'baci:cart-client-credential';

let ephemeralCredential: string | null = null;

/**
 * UUID v4 generation that never throws: crypto.randomUUID is
 * secure-context-only and missing in older browsers, so fall back to
 * shaping getRandomValues output, and finally to no credential at
 * all (the server then uses its legacy network identity, exactly as
 * before this header existed). Generating a quota key must never
 * break a cart call.
 */
function generateCredential(): string | null {
  try {
    if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0'));
    return `${hex.slice(0, 4).join('')}-${hex.slice(4, 6).join('')}-${hex
      .slice(6, 8)
      .join('')}-${hex.slice(8, 10).join('')}-${hex.slice(10).join('')}`;
  } catch {
    return null;
  }
}

/**
 * This browser profile's anonymous cart quota credential: generated
 * once, persisted in localStorage, and sent on bootstrap/create/
 * handoff-preview calls so the server keys anonymous budgets on it
 * instead of the shared network address. It is not an authentication
 * credential and grants no access to any cart. When storage is
 * unavailable (blocked cookies/storage), a per-page-load credential
 * still separates this shopper from other egress-sharers for the
 * session; when no crypto source exists, returns null and callers
 * simply omit the header.
 */
export function getCartClientCredential(): string | null {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (isValidCartClientCredential(stored)) return stored;
    const generated = generateCredential();
    if (generated === null) return null;
    window.localStorage.setItem(STORAGE_KEY, generated);
    return generated;
  } catch {
    ephemeralCredential ??= generateCredential();
    return ephemeralCredential;
  }
}

export function cartClientCredentialHeaders(): Record<string, string> {
  const credential = getCartClientCredential();
  return credential === null
    ? {}
    : { [CART_CLIENT_CREDENTIAL_HEADER]: credential };
}
