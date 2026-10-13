import type { RelatedBlogProduct } from '@/lib/related-blog-products';

/** Merges canonical serialized-inventory projections without reordering the rail. */
export function mergeRelatedBlogProductSerializedInventory(
  products: readonly RelatedBlogProduct[],
  serializedProducts: readonly RelatedBlogProduct[]
): RelatedBlogProduct[] {
  const serializedProductsById = new Map(
    serializedProducts.map((product) => [product.id, product])
  );
  return products.map(
    (product) => serializedProductsById.get(product.id) ?? product
  );
}
