import type { GoogleMerchantListing } from '@/app/api/feed/google-merchant/feed-builder';
import type { CrossRemListingBinding } from '@/schemas/crossrem-listing-binding';

export const CONDITION_LABELS = {
  new: 'New',
  used: 'Used',
  uk_used: 'UK Used',
  open_box: 'Open Box',
  refurbished: 'Refurbished',
} as const;

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

export function getSellableIdentity(row: GoogleMerchantListing) {
  const condition = (row.variant ?? row.offer ?? row.product).condition;
  if (!condition || !Object.hasOwn(CONDITION_LABELS, condition)) return null;

  return {
    productId: row.product.id,
    variantId: row.variant?.id,
    offerId: row.offer?.id,
    condition,
  };
}
