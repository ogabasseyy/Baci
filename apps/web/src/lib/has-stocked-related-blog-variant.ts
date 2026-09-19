import { getEffectiveStock } from '@/lib/product-stock';
import type { RelatedBlogProduct } from '@/lib/related-blog-products';

interface VariantStockRow {
  product_id?: unknown;
  stock_quantity?: number | string | null;
}

function isVariantStockRow(value: unknown): value is VariantStockRow {
  return typeof value === 'object' && value !== null;
}

function getEffectiveVariantStock(
  variant: VariantStockRow,
  product: RelatedBlogProduct
): number {
  return variant.stock_quantity == null
    ? getEffectiveStock(product)
    : getEffectiveStock(variant);
}

/** Returns whether a public variant can inherit and use the parent stock. */
export function hasStockedRelatedBlogVariant(
  data: unknown,
  product: RelatedBlogProduct
): boolean {
  return (
    Array.isArray(data) &&
    data.some(
      (variant) =>
        isVariantStockRow(variant) &&
        variant.product_id === product.id &&
        getEffectiveVariantStock(variant, product) > 0
    )
  );
}
