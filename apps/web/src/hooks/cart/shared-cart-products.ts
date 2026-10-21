import {
  getPrimaryProductImage,
  PRODUCT_IMAGE_PLACEHOLDER_URL,
} from '@/lib/product-image';

import type { Product } from '@/lib/products';

export const HYDRATION_SELECT =
  'id, name, description, status, price, manage_stock, stock, stock_quantity, has_variants, has_condition_offers, brand, gtin, mpn, merchant_id, images, imageHint:image_hint';

/**
 * Hydrates catalog shells for confirmed lines the client has never seen
 * (another device's lines after a handoff, poll convergence). Mirrors
 * the cart-link transfer select so shells match transfer-added lines.
 * Degrades to an empty map on any failure: unhydrated lines keep
 * rendering as shells with their authoritative totals.
 */
export async function fetchSharedCartProducts(
  productIds: string[],
  merchantId: string
): Promise<Map<string, Product>> {
  const empty = new Map<string, Product>();
  const unique = [...new Set(productIds.filter((id) => id.trim().length > 0))];
  if (unique.length === 0) return empty;
  try {
    // Loaded on demand: the cart provider wraps every storefront page, so a
    // static import would ship supabase-js in every page's initial <head> JS.
    const { createClient } = await import('@/lib/supabase/client');
    const supabase = createClient();
    const { data, error } = await supabase
      .from('products')
      .select(HYDRATION_SELECT)
      .eq('merchant_id', merchantId)
      .in('id', unique)
      .eq('status', 'active');
    if (error || !Array.isArray(data)) return empty;
    const products = new Map<string, Product>();
    for (const row of data as Record<string, unknown>[]) {
      if (typeof row.id !== 'string' || row.status !== 'active') continue;
      const image =
        getPrimaryProductImage(
          Array.isArray(row.images) ? (row.images as string[]) : []
        ) || PRODUCT_IMAGE_PLACEHOLDER_URL;
      products.set(row.id, {
        ...(row as object),
        image,
        imageLarge: image,
      } as Product);
    }
    return products;
  } catch {
    return empty;
  }
}
