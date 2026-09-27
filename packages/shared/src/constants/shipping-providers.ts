/**
 * Carrier integrations merchants can explicitly enable for live checkout
 * quotes. Values are persisted in `merchant_feature_settings.shipping_providers`.
 */
export const CARRIER_PROVIDER_IDS = ['gigl', 'topship'] as const;

export type CarrierProviderId = (typeof CARRIER_PROVIDER_IDS)[number];

export const CARRIER_PROVIDER_CODE_BY_ID = {
  gigl: 'GIGL',
  topship: 'TOPSHIP',
} as const satisfies Record<CarrierProviderId, string>;

export type CarrierProviderCode =
  (typeof CARRIER_PROVIDER_CODE_BY_ID)[CarrierProviderId];

export function isCarrierProviderId(value: string): value is CarrierProviderId {
  return CARRIER_PROVIDER_IDS.some((providerId) => providerId === value);
}

/**
 * Normalizes persisted provider settings into the supported carrier catalog.
 * The database can contain legacy or malformed JSON, so callers get an empty,
 * de-duplicated list rather than an invalid provider reaching checkout.
 */
export function normalizeCarrierProviderIds(
  value: unknown
): CarrierProviderId[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const providerIds = new Set<CarrierProviderId>();
  for (const candidate of value) {
    if (typeof candidate !== 'string') {
      continue;
    }

    const providerId = candidate.trim().toLowerCase();
    if (isCarrierProviderId(providerId)) {
      providerIds.add(providerId);
    }
  }

  return [...providerIds];
}
