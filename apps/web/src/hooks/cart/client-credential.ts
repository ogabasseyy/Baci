import {
  CART_CLIENT_CREDENTIAL_HEADER,
  isValidCartClientCredential,
} from '@baci/shared/cart';

const STORAGE_KEY = 'baci:cart-client-credential';

let ephemeralCredential: string | null = null;

/**
 * This browser profile's anonymous cart quota credential: generated
 * once, persisted in localStorage, and sent on bootstrap/create/
 * handoff-preview calls so the server keys anonymous budgets on it
 * instead of the shared network address. It is not an authentication
 * credential and grants no access to any cart. When storage is
 * unavailable (blocked cookies/storage), a per-page-load credential
 * still separates this shopper from other egress-sharers for the
 * session.
 */
export function getCartClientCredential(): string {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (isValidCartClientCredential(stored)) return stored;
    const generated = crypto.randomUUID();
    window.localStorage.setItem(STORAGE_KEY, generated);
    return generated;
  } catch {
    ephemeralCredential ??= crypto.randomUUID();
    return ephemeralCredential;
  }
}

export function cartClientCredentialHeaders(): Record<string, string> {
  return { [CART_CLIENT_CREDENTIAL_HEADER]: getCartClientCredential() };
}
