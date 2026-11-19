import {
  GIGL_PLATFORM_MARGIN_BPS,
  GIGL_PRICING_VERSION,
  type GiglPricingSnapshot,
} from './gigl-pricing-constants';

export function toSnapshot(
  providerCostKobo: number,
  chargedTotalKobo: number
): GiglPricingSnapshot {
  if (!Number.isSafeInteger(chargedTotalKobo)) {
    throw new Error('GIGL provider cost is too large');
  }
  return {
    providerCost: providerCostKobo / 100,
    platformMargin: (chargedTotalKobo - providerCostKobo) / 100,
    price: chargedTotalKobo / 100,
    marginBasisPoints: GIGL_PLATFORM_MARGIN_BPS,
    pricingVersion: GIGL_PRICING_VERSION,
  };
}
