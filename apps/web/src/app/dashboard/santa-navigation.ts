export function isSantaCampaignVisible(
  merchantSlug: string | null | undefined,
  configuredMerchantSlug: string | null | undefined
): boolean {
  return (
    Boolean(configuredMerchantSlug) && merchantSlug === configuredMerchantSlug
  );
}
