import type { GoogleMerchantListing } from '@/app/api/feed/google-merchant/feed-builder';
import { CONDITION_LABELS } from './condition-labels';

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
