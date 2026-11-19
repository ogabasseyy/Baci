import type { AnalyticsProduct } from './analytics-product';

export interface EcommerceItem {
  item_id: string;
  item_name: string;
  item_category?: string;
  item_brand?: string;
  price: number;
  quantity?: number;
  item_variant?: string;
}

/** Converts a product to the GA4 ecommerce item format. */
export function productToItem(
  product: AnalyticsProduct,
  quantity: number = 1,
  variant?: string
): EcommerceItem {
  // Use joined categories.name from category_id, fallback to legacy TEXT field
  const categoryName =
    product.categories?.name || product.category || undefined;

  return {
    item_id: product.id,
    item_name: product.name,
    item_category: categoryName,
    price: product.price,
    quantity,
    item_variant: variant,
  };
}
