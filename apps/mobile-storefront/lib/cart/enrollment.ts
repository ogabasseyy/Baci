function hasCartFeature(features: unknown, feature: string): boolean {
  // Require exact canonical lowercase values matching the SQL cart RPCs
  // and realtime checks (`premium_features @> '["shared_cart"]'::jsonb`).
  // Non-string or non-canonical entries stay disabled so client surfaces
  // never light up when the database gates would reject them.
  return (
    Array.isArray(features) &&
    features.some((value) => typeof value === 'string' && value === feature)
  );
}

/** Native activation is a separate explicit qualification gate; all_features cannot enable it. */
export function nativeCartEnabled(
  merchant:
    | { id: string; slug: string; premium_features?: string[] | null }
    | undefined,
  config: { merchantId: string; merchantSlug: string }
): boolean {
  return Boolean(
    config.merchantId &&
      merchant?.id.toLowerCase() === config.merchantId.toLowerCase() &&
      merchant.slug === config.merchantSlug &&
      hasCartFeature(merchant.premium_features, 'shared_cart') &&
      hasCartFeature(merchant.premium_features, 'shared_cart_native')
  );
}

/** Account linking additionally requires the accounts enrollment. */
export function nativeCartAccountsEnabled(
  merchant:
    | { id: string; slug: string; premium_features?: string[] | null }
    | undefined,
  config: { merchantId: string; merchantSlug: string }
): boolean {
  return Boolean(
    nativeCartEnabled(merchant, config) &&
      hasCartFeature(merchant?.premium_features, 'shared_cart_accounts')
  );
}
