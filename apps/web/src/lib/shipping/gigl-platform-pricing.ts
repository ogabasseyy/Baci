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

function toProviderCostKobo(providerCost: number): number {
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
function minimumChargeKobo(providerCostKobo: number): number {
  return Math.ceil(
    (providerCostKobo * (10_000 + GIGL_PLATFORM_MARGIN_BPS)) / 10_000
  );
}

function toSnapshot(
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
