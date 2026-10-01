export const GIGL_PRICING_VERSION = 'gigl_platform_margin_v1' as const;
export const GIGL_PLATFORM_MARGIN_BPS = 1000 as const;

export interface GiglPricingSnapshot {
  providerCost: number;
  platformMargin: number;
  price: number;
  marginBasisPoints: typeof GIGL_PLATFORM_MARGIN_BPS;
  pricingVersion: typeof GIGL_PRICING_VERSION;
}

/** Convert a fresh GIGL provider tariff (naira) into the bundled public price. */
export function priceGiglQuote(providerCost: number): GiglPricingSnapshot {
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
  const chargedTotalKobo = Math.ceil(
    (providerCostKobo * (10_000 + GIGL_PLATFORM_MARGIN_BPS)) / 10_000
  );
  const marginKobo = chargedTotalKobo - providerCostKobo;
  if (!Number.isSafeInteger(chargedTotalKobo)) {
    throw new Error('GIGL provider cost is too large');
  }
  return {
    providerCost: providerCostKobo / 100,
    platformMargin: marginKobo / 100,
    price: chargedTotalKobo / 100,
    marginBasisPoints: GIGL_PLATFORM_MARGIN_BPS,
    pricingVersion: GIGL_PRICING_VERSION,
  };
}
