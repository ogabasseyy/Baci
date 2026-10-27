import {
  CART_CLIENT_CREDENTIAL_HEADER,
  isValidCartClientCredential,
} from '@baci/shared/cart';
import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';

const STORAGE_KEY = 'baci.cart.client-credential';

let credentialPromise: Promise<string | null> | undefined;
let ephemeralCredential: string | undefined;

/** Generation that never throws: a quota key must not break cart calls. */
function generateCredential(): string | null {
  try {
    return Crypto.randomUUID();
  } catch {
    return null;
  }
}

/**
 * This install's anonymous cart quota credential: generated once,
 * persisted in SecureStore, and sent on bootstrap/create/handoff
 * preview calls so the server keys anonymous budgets on it instead
 * of the shared network address. It is not an authentication
 * credential and grants no access to any cart. When SecureStore is
 * unavailable, a per-process credential still separates this shopper
 * from other egress-sharers until the app restarts; when generation
 * itself fails, returns null and callers omit the header (the server
 * then uses its legacy network identity). Never rejects.
 */
export function getCartClientCredential(): Promise<string | null> {
  credentialPromise ??= loadCredential();
  return credentialPromise;
}

async function loadCredential(): Promise<string | null> {
  try {
    const stored = await SecureStore.getItemAsync(STORAGE_KEY);
    if (isValidCartClientCredential(stored)) return stored;
    const generated = generateCredential();
    if (generated === null) return null;
    await SecureStore.setItemAsync(STORAGE_KEY, generated);
    return generated;
  } catch {
    ephemeralCredential ??= generateCredential() ?? undefined;
    return ephemeralCredential ?? null;
  }
}

export async function cartClientCredentialHeaders(): Promise<
  Record<string, string>
> {
  const credential = await getCartClientCredential();
  return credential === null
    ? {}
    : { [CART_CLIENT_CREDENTIAL_HEADER]: credential };
}
