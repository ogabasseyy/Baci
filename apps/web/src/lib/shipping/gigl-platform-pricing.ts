import { minimumChargeKobo } from './gigl-minimum-charge-kobo';
import {
  GIGL_PRICE_ROUNDING_KOBO,
  type GiglPricingSnapshot,
} from './gigl-pricing-constants';
import { toSnapshot } from './gigl-pricing-snapshot';
import { toProviderCostKobo } from './gigl-provider-cost-kobo';

export {
  GIGL_PLATFORM_MARGIN_BPS,
  GIGL_PRICE_ROUNDING_KOBO,
  GIGL_PRICING_VERSION,
  type GiglPricingSnapshot,
} from './gigl-pricing-constants';

/**
 * Convert a fresh GIGL provider tariff (naira) into the bundled public price:
 * cost plus at least 10%, rounded up to the next whole NGN 100, with the
 * margin absorbing the rounding (margin = price - cost).
 *
 * The pricing version stays `gigl_platform_margin_v1`. v1 rows created before
 * the NGN 100 rounding deployed used the unrounded rule
 * (`priceGiglQuoteUnroundedV1`); only the creation time tells them apart. The
 * database accepts either v1 price for a given cost.
 */
export function priceGiglQuote(providerCost: number): GiglPricingSnapshot {
  const providerCostKobo = toProviderCostKobo(providerCost);
  const minimumKobo = minimumChargeKobo(providerCostKobo);
  const remainder = minimumKobo % GIGL_PRICE_ROUNDING_KOBO;
  const chargedTotalKobo =
    remainder === 0
      ? minimumKobo
      : minimumKobo + (GIGL_PRICE_ROUNDING_KOBO - remainder);
  return toSnapshot(providerCostKobo, chargedTotalKobo);
}
