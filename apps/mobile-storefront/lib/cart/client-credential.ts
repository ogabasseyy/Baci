import {
  CART_CLIENT_CREDENTIAL_HEADER,
  isValidCartClientCredential,
} from '@baci/shared/cart';
import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';

const credentialPromises = new Map<string, Promise<string | null>>();
const ephemeralCredentials = new Map<string, string>();

function storageKey(merchantSlug: string): string {
  return `baci.cart.client-credential.${merchantSlug}`;
}

/** Generation that never throws: a quota key must not break cart calls. */
function generateCredential(): string | null {
  try {
    return Crypto.randomUUID();
  } catch {
    return null;
  }
}

/**
 * This install's anonymous cart quota credential for one merchant:
 * generated once, persisted in SecureStore under a per-merchant key,
 * and sent on bootstrap/create/handoff preview calls so the server
 * keys anonymous budgets on it instead of the shared network
 * address. Per-merchant storage means one shopper presents
 * unlinkable credentials across merchants. It is not an
 * authentication credential and grants no access to any cart. When
 * SecureStore is unavailable, a per-process credential still
 * separates this shopper from other egress-sharers until the app
 * restarts; when generation itself fails, returns null and callers
 * omit the header (the server then uses its legacy network
 * identity). Never rejects.
 */
export function getCartClientCredential(
  merchantSlug: string
): Promise<string | null> {
  let promise = credentialPromises.get(merchantSlug);
  if (!promise) {
    promise = loadCredential(merchantSlug);
    credentialPromises.set(merchantSlug, promise);
  }
  return promise;
}

async function loadCredential(merchantSlug: string): Promise<string | null> {
  const key = storageKey(merchantSlug);
  try {
    const stored = await SecureStore.getItemAsync(key);
    if (isValidCartClientCredential(stored)) return stored;
    const generated = generateCredential();
    if (generated === null) return null;
    await SecureStore.setItemAsync(key, generated);
    return generated;
  } catch {
    let ephemeral = ephemeralCredentials.get(merchantSlug);
    if (ephemeral === undefined) {
      ephemeral = generateCredential() ?? undefined;
      if (ephemeral !== undefined) {
        ephemeralCredentials.set(merchantSlug, ephemeral);
      }
    }
    return ephemeral ?? null;
  }
}

export async function cartClientCredentialHeaders(
  merchantSlug: string
): Promise<Record<string, string>> {
  const credential = await getCartClientCredential(merchantSlug);
  return credential === null
    ? {}
    : { [CART_CLIENT_CREDENTIAL_HEADER]: credential };
}
