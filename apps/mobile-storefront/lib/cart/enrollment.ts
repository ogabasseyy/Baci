function hasCartFeature(
  features: string[] | null | undefined,
  feature: string
): boolean {
  // Match the web gate's normalization (trim + lowercase). Stored
  // values should still be canonical exact lowercase: the SQL cart
  // RPCs and realtime checks use exact jsonb containment.
  return (
    features?.some((value) => value.trim().toLowerCase() === feature) ?? false
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
