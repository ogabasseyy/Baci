/**
 * Build a page- or product-group-scoped JSON-LD `@id` prefix so two products on
 * the same document never accidentally share policy or seller nodes.
 */
export function getProductScopedPrefix(
  productUrl: URL | undefined,
  productGroupId: string
): string {
  return productUrl
    ? `${productUrl.origin}${productUrl.pathname}#`
    : `#${encodeURIComponent(productGroupId)}-`;
}
