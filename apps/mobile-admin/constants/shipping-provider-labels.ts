/**
 * Merchant-facing names for shipping providers, keyed by the provider code the
 * quote API returns. Add a provider here so shared shipment UI ("Ship with …")
 * names it without hardcoding.
 */
export const SHIPPING_PROVIDER_LABELS = {
  GIGL: 'GIG',
} as const satisfies Record<string, string>;
