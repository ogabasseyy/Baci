import { normalizeCanonicalProductCondition } from '@baci/shared/lib';

export function getCartValidationKey(
  id: string,
  variantId?: string,
  offerId?: string
) {
  const variantKey = variantId ? `${id}::${variantId}` : id;
  return offerId ? `${variantKey}::offer=${offerId}` : variantKey;
}

export type OfferParentFlags = {
  has_condition_offers: boolean | null;
  has_variants: boolean | null;
  variant_model: string | null;
};

/**
 * Mirrors the order RPC's offer parent gate (M28): the flag must be on,
 * the parent must be non-variant (sku_matrix counts as variant-bearing),
 * and no live non-anchor variants may exist. The variants RPC already
 * excludes inventory anchors, so any row for the product fails the gate.
 * Without this, background validation would retain and reprice a stale
 * offer line that order creation then rejects at checkout.
 */
export function isOfferParentEligible(
  product: OfferParentFlags,
  productHasLiveVariants: boolean
): boolean {
  if (product.has_condition_offers !== true) return false;
  if (
    product.has_variants === true ||
    (product.variant_model ?? '') === 'sku_matrix'
  )
    return false;
  if (productHasLiveVariants) return false;
  return true;
}

export type OfferLineResolutionInput = {
  strId: string;
  variantId?: string;
  offerId?: string;
  submittedCondition?: string;
  offer?: { condition: string | null };
  parentEligible: boolean;
};

/**
 * Resolves the offer-line checks for one cart validation item: a missing
 * live row (the RPC returns active rows only), a stale row on a
 * variant-bearing or flag-disabled parent, a condition the merchant
 * changed after the line landed in the cart, or a contradictory
 * variant+offer combo. Returns the invalid-line key, or null when the
 * line passes every offer check (non-offer lines always pass).
 */
export function getInvalidOfferLineKey({
  strId,
  variantId,
  offerId,
  submittedCondition,
  offer,
  parentEligible,
}: OfferLineResolutionInput): string | null {
  // Non-variant offer lines price from the live condition offer, not
  // the parent: pricing them from products.price would silently
  // replace the advertised offer price on every validation pass. A
  // missing row means the offer is gone, so only that line is
  // invalidated.
  if (!variantId && offerId && !offer) {
    return getCartValidationKey(strId, undefined, offerId);
  }

  // A live offer row on a variant-bearing (or flag-disabled) parent is
  // stale: order creation rejects it, so validation must not retain
  // and reprice the line only to fail at checkout.
  if (!variantId && offerId && offer && !parentEligible) {
    return getCartValidationKey(strId, undefined, offerId);
  }

  // Staff can change an active offer's condition after it lands in a
  // cart. The orders route canonically compares and rejects a drifted
  // persisted condition, so validation invalidates the line early —
  // mirroring that comparison — instead of reporting it valid and
  // failing only at checkout. Lines without a submitted condition
  // skip the check, same as the orders route.
  if (
    !variantId &&
    offerId &&
    offer &&
    submittedCondition != null &&
    normalizeCanonicalProductCondition(submittedCondition) !==
      normalizeCanonicalProductCondition(offer.condition ?? '')
  ) {
    return getCartValidationKey(strId, undefined, offerId);
  }

  // A line naming both a variant and a condition offer is contradictory:
  // offers exist only for non-variant products, so neither platform
  // attaches both and there is no defined price basis. Reject the line
  // so cart and checkout agree — the orders route verifies any carried
  // offer_id and would reject a dead one there instead.
  if (variantId && offerId) {
    return getCartValidationKey(strId, variantId, offerId);
  }

  return null;
}
