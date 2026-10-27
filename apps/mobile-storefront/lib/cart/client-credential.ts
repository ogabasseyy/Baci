import {
  CART_CLIENT_CREDENTIAL_HEADER,
  isValidCartClientCredential,
} from '@baci/shared/cart';
import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';

const STORAGE_KEY = 'baci.cart.client-credential';

let credentialPromise: Promise<string> | undefined;
let ephemeralCredential: string | undefined;

/**
 * This install's anonymous cart quota credential: generated once,
 * persisted in SecureStore, and sent on bootstrap/create/handoff
 * preview calls so the server keys anonymous budgets on it instead
 * of the shared network address. It is not an authentication
 * credential and grants no access to any cart. When SecureStore is
 * unavailable, a per-process credential still separates this shopper
 * from other egress-sharers until the app restarts.
 */
export function getCartClientCredential(): Promise<string> {
  credentialPromise ??= loadCredential();
  return credentialPromise;
}

async function loadCredential(): Promise<string> {
  try {
    const stored = await SecureStore.getItemAsync(STORAGE_KEY);
    if (isValidCartClientCredential(stored)) return stored;
    const generated = Crypto.randomUUID();
    await SecureStore.setItemAsync(STORAGE_KEY, generated);
    return generated;
  } catch {
    ephemeralCredential ??= Crypto.randomUUID();
    return ephemeralCredential;
  }
}

export async function cartClientCredentialHeaders(): Promise<
  Record<string, string>
> {
  return { [CART_CLIENT_CREDENTIAL_HEADER]: await getCartClientCredential() };
}
