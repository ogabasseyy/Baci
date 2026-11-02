export const GIGL_PRICING_VERSION = 'gigl_platform_margin_v1' as const;
/**
 * Minimum platform margin in basis points (10%). Since prices are rounded up
 * to whole NGN 100 this is a floor, not the exact margin: the stored
 * platform_margin is always price - provider_cost.
 */
export const GIGL_PLATFORM_MARGIN_BPS = 1000 as const;
/** Bundled GIGL prices are rounded up to the next whole NGN 100. */
export const GIGL_PRICE_ROUNDING_KOBO = 10_000 as const;

export interface GiglPricingSnapshot {
  providerCost: number;
  platformMargin: number;
  price: number;
  marginBasisPoints: typeof GIGL_PLATFORM_MARGIN_BPS;
  pricingVersion: typeof GIGL_PRICING_VERSION;
}

export function toProviderCostKobo(providerCost: number): number {
  if (!Number.isFinite(providerCost)) {
    throw new Error('GIGL provider cost must be finite');
  }
  if (providerCost <= 0) {
    throw new Error('GIGL provider cost must be positive');
  }
  const providerCostKobo = Math.round(providerCost * 100);
  if (providerCostKobo <= 0) {
    throw new Error('GIGL provider cost must be positive');
  }
  if (!Number.isSafeInteger(providerCostKobo)) {
    throw new Error('GIGL provider cost is too large');
  }
  return providerCostKobo;
}

/** Cost plus the 10% margin floor, ceiled to the kobo. */
export function minimumChargeKobo(providerCostKobo: number): number {
  return Math.ceil(
    (providerCostKobo * (10_000 + GIGL_PLATFORM_MARGIN_BPS)) / 10_000
  );
}

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
