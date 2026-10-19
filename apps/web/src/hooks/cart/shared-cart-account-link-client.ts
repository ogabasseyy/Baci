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
