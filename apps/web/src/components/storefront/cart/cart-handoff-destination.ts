import type { CartSnapshot } from '@baci/shared/cart';
import { fetchJson } from './cart-handoff-support';

export type DestinationLoad =
  | { status: 'checked'; cart: CartSnapshot | null; bootstrapRequired: boolean }
  | { status: 'error' };

/**
 * Read the signed-in destination cart for a handoff preview. A 401
 * proof-boundary reply means the next redemption must bootstrap a
 * fresh session first; 404 not_found/expired simply means no
 * destination cart exists yet.
 */
export async function fetchDestinationCart(
  slug: string | null
): Promise<DestinationLoad> {
  const url = slug
    ? `/api/storefront/cart?merchantSlug=${encodeURIComponent(slug)}`
    : '/api/storefront/cart';
  try {
    const response = await fetchJson(url);
    const payload = (await response.json()) as {
      cart?: CartSnapshot;
      code?: string;
    };
    if (!response.ok) {
      if (
        response.status === 401 &&
        ['missing_proof', 'expired_proof', 'invalid_proof'].includes(
          payload.code ?? ''
        )
      ) {
        return { status: 'checked', cart: null, bootstrapRequired: true };
      }
      if (
        response.status !== 404 ||
        !['not_found', 'expired'].includes(payload.code ?? '')
      ) {
        return { status: 'error' };
      }
      return { status: 'checked', cart: null, bootstrapRequired: false };
    }
    return {
      status: 'checked',
      cart: payload.cart ?? null,
      bootstrapRequired: false,
    };
  } catch {
    return { status: 'error' };
  }
}
