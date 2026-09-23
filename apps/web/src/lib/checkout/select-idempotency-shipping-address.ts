/**
 * Choose the shipping address that feeds the checkout idempotency hash.
 *
 * Merchant-rate Nigerian state repair must persist the canonical state, but the
 * hash has to stay on the pre-repair destination. Retries that straddle this
 * deploy otherwise recompute a different hash for the same Idempotency-Key
 * (for example, stored `100001` vs repaired `Lagos`) and hit
 * `checkout_idempotency_conflict` instead of replaying the existing order.
 */
export function selectIdempotencyShippingAddress<TShippingAddress>({
  addressBeforeMerchantRateNormalization,
}: {
  addressBeforeMerchantRateNormalization: TShippingAddress;
  normalizedAddress: TShippingAddress;
}): TShippingAddress {
  return addressBeforeMerchantRateNormalization;
}
