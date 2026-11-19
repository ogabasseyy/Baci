import { PRODUCT_COLUMNS, PRODUCT_COLUMNS_PUBLIC } from '@/lib/product-queries';
import type { createClient } from '@/lib/supabase/server';

export interface RefreshedProductFallback {
  id: string;
  name?: string | null;
  description?: string | null;
  brand?: string | null;
  color?: string | null;
  slug?: string | null;
  category?: string | null;
  condition?: string | null;
  condition_detail?: string | null;
  has_variants?: boolean | null;
  variant_model?: string | null;
}

export interface RefreshUpdatedProductParams<
  TFallback extends RefreshedProductFallback,
> {
  supabase: ReturnType<typeof createClient>;
  productId: string;
  merchantId: string;
  canViewProducts: boolean;
  fallbackProduct: TFallback;
}

export interface RefreshUpdatedProductResult<
  TFallback extends RefreshedProductFallback,
> {
  updatedProduct: TFallback & { images?: unknown };
  refreshFailed: boolean;
}

/**
 * Re-reads an updated product row from `merchant_products` (with cost columns)
 * or public `products` (for edit-only staff), falling back to `fallbackProduct`
 * so downstream embedding/cache invalidation can proceed even if the read fails.
 */
export async function refreshUpdatedProduct<
  TFallback extends RefreshedProductFallback,
>({
  supabase,
  productId,
  merchantId,
  canViewProducts,
  fallbackProduct,
}: RefreshUpdatedProductParams<TFallback>): Promise<
  RefreshUpdatedProductResult<TFallback>
> {
  const { data: refreshedProduct, error: refreshedProductError } =
    canViewProducts
      ? await supabase
          .from('merchant_products')
          .select(PRODUCT_COLUMNS)
          .eq('id', productId)
          .eq('merchant_id', merchantId)
          .single()
      : await supabase
          .from('products')
          .select(PRODUCT_COLUMNS_PUBLIC)
          .eq('id', productId)
          .eq('merchant_id', merchantId)
          .single();

  if (refreshedProductError || !refreshedProduct) {
    console.error('Error refreshing updated product:', refreshedProductError);
    return {
      updatedProduct: fallbackProduct,
      refreshFailed: true,
    };
  }

  return {
    updatedProduct: refreshedProduct as unknown as TFallback & {
      images?: unknown;
    },
    refreshFailed: false,
  };
}
