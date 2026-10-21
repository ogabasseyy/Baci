import type {
  RelatedBlogProduct,
  RelatedBlogProductVariant,
} from '@/lib/related-blog-products';
import { toFinitePrice } from '@/lib/to-finite-price';

interface VariantStockRow {
  id?: string | null;
  inventory_tracking_policy?: string | null;
  price_override?: number | string | null;
  product_id?: string | null;
  stock_quantity?: number | string | null;
}

function isVariantStockRow(value: unknown): value is VariantStockRow {
  return typeof value === 'object' && value !== null;
}

export function normalizeRelatedBlogVariantRows(
  data: unknown,
  product: RelatedBlogProduct
): RelatedBlogProductVariant[] {
  if (!Array.isArray(data)) return [];

  return data.flatMap((variant) => {
    if (!isVariantStockRow(variant) || variant.product_id !== product.id) {
      return [];
    }
    const priceOverride = toFinitePrice(variant.price_override);
    const parentPrice = toFinitePrice(product.price);
    return [
      {
        ...(variant.id ? { id: variant.id } : {}),
        ...(variant.inventory_tracking_policy
          ? { inventory_tracking_policy: variant.inventory_tracking_policy }
          : {}),
        ...(priceOverride !== null
          ? { price_override: priceOverride }
          : parentPrice !== null
            ? { price_override: parentPrice }
            : {}),
        stock_quantity: toFinitePrice(variant.stock_quantity),
      },
    ];
  });
}
