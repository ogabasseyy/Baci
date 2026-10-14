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
      merchant.premium_features?.includes('shared_cart') &&
      merchant.premium_features.includes('shared_cart_native')
  );
}
