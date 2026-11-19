import type { CrossRemListingBinding } from '@/schemas/crossrem-listing-binding';

export function sellableIdentityKey(
  identity: Pick<
    CrossRemListingBinding,
    'productId' | 'variantId' | 'offerId' | 'condition'
  >
) {
  return JSON.stringify([
    identity.productId,
    identity.variantId ?? null,
    identity.offerId ?? null,
    identity.condition,
  ]);
}
