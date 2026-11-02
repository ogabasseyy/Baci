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
