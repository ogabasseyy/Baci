export function hasCartMerchantContext(
  cartMerchantSlug: string | null,
  storefrontMerchantSlug: string | null | undefined
): boolean {
  return (
    !cartMerchantSlug ||
    !storefrontMerchantSlug ||
    cartMerchantSlug === storefrontMerchantSlug
  );
}
