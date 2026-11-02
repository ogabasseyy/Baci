import {
  type GiglPricingSnapshot,
  minimumChargeKobo,
  toProviderCostKobo,
  toSnapshot,
} from './gigl-pricing-arithmetic';

/**
 * The original v1 rule: cost plus 10%, ceiled to the kobo, without NGN 100
 * rounding. Use it only to re-price a replacement quote for an order that was
 * already paid at this price; never for new quotes.
 */
export function priceGiglQuoteUnroundedV1(
  providerCost: number
): GiglPricingSnapshot {
  const providerCostKobo = toProviderCostKobo(providerCost);
  return toSnapshot(providerCostKobo, minimumChargeKobo(providerCostKobo));
}
