import type { CartSnapshot } from '@baci/shared/cart';

import { fetchWithCsrf } from '@/lib/api-client';
import type { CartAccountLinkInput } from '@/schemas/cart-account';

import {
  cartRoute,
  failureOf,
  isSnapshot,
  readBody,
  type SharedCartMutationResult,
  warningsOf,
} from './shared-cart-client';

export type SavedAccountCartResult =
  | { ok: true; cart: CartSnapshot | null }
  | { ok: false; code: string; retryable: boolean };

/** Authenticated read of the account-saved cart; never creates a cart. */
export async function fetchSavedAccountCart(
  merchantSlug?: string | null
): Promise<SavedAccountCartResult> {
  let response: Response;
  try {
    response = await fetchWithCsrf(
      cartRoute('/api/storefront/cart/account', merchantSlug),
      { method: 'GET' }
    );
  } catch {
    return { code: 'temporarily_unavailable', ok: false, retryable: true };
  }
  const body = await readBody(response);
  if (response.ok && body) {
    if (body.cart === null) return { cart: null, ok: true };
    if (isSnapshot(body.cart))
      return { cart: body.cart as CartSnapshot, ok: true };
    return { code: 'temporarily_unavailable', ok: false, retryable: true };
  }
  const failure = failureOf(body, response.status);
  return { code: failure.code, ok: false, retryable: failure.retryable };
}

/**
 * Explicit account choice. The caller keeps one operationId until the
 * outcome is known, so a lost response replays the committed link
 * instead of linking twice.
 */
export async function linkAccountCart(
  input: CartAccountLinkInput,
  merchantSlug?: string | null
): Promise<SharedCartMutationResult> {
  let response: Response;
  try {
    response = await fetchWithCsrf(
      cartRoute('/api/storefront/cart/account', merchantSlug),
      {
        body: JSON.stringify(input),
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
      }
    );
  } catch {
    return {
      code: 'temporarily_unavailable',
      ok: false,
      retryable: true,
      snapshot: null,
    };
  }
  const body = await readBody(response);
  if (response.ok && body && isSnapshot(body.cart)) {
    return {
      ok: true,
      replayed: body.replayed === true,
      snapshot: body.cart as CartSnapshot,
      warnings: warningsOf(body),
    };
  }
  if (response.ok) {
    return {
      code: 'temporarily_unavailable',
      ok: false,
      retryable: true,
      snapshot: null,
    };
  }
  return failureOf(body, response.status);
}

/** Device-scoped revocation on sign-out; never clears the shared cart. */
export async function revokeCartDeviceSession(
  merchantSlug?: string | null
): Promise<{ ok: boolean }> {
  try {
    const response = await fetchWithCsrf(
      cartRoute('/api/storefront/cart/session/revoke', merchantSlug),
      {
        body: JSON.stringify({}),
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
      }
    );
    const body = await readBody(response);
    // No proof means no cart authority exists to retire (ordinary legacy logout).
    return {
      ok: response.ok
        ? body?.revoked === true
        : response.status === 401 && body?.code === 'missing_proof',
    };
  } catch {
    return { ok: false };
  }
}
