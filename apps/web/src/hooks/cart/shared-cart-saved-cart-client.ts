import type { CartSnapshot } from '@baci/shared/cart';
import { fetchWithCsrf } from '@/lib/api-client';
import {
  cartRoute,
  failureOf,
  isSnapshot,
  readBody,
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
