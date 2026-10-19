import { getEffectiveStock } from '@/lib/product-stock';
import type { RelatedBlogProduct } from '@/lib/related-blog-products';

interface VariantStockRow {
  inventory_tracking_policy?: unknown;
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
        // `serialized_then_unlimited` stays purchasable after its serialized
        // units are exhausted (isPublicVariantPurchasable parity): a zero
        // numeric stock must not mark the variant unavailable when the
        // canonical serialized summary is unreachable and this first pass is
        // all the rail has.
        (variant.inventory_tracking_policy === 'serialized_then_unlimited' ||
          getEffectiveVariantStock(variant, product) > 0)
    )
  );
}
