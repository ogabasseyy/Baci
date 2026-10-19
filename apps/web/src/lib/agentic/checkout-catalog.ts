import type { SupabaseClient } from '@supabase/supabase-js';
import type { CheckoutItem } from './checkout';

export interface AgenticProduct {
  id: string;
  name: string;
  price: number;
  stock: number;
  stock_quantity?: number;
  manage_stock?: boolean | null;
  weight_value?: number;
  weight_unit?: string;
}

export interface AgenticVariant {
  id: string;
  merchant_id: string;
  product_id: string;
  price_override?: number;
  stock_quantity: number;
  attributes?: Record<string, string>;
  product?: {
    manage_stock?: boolean | null;
    name: string;
    price?: number;
    weight_unit?: string;
    weight_value?: number;
  };
}

const POSTGRES_UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Loads the parent products and variants a UCP quote may reference.
 * Item ids may be product ids, variant ids, or explicit variant lanes;
 * non-UUID external ids are left to per-item validation instead of
 * being sent through UUID filters.
 */
export async function loadCheckoutCatalog(
  supabase: SupabaseClient,
  items: CheckoutItem[],
  merchantId: string
): Promise<{ products: AgenticProduct[]; variants: AgenticVariant[] }> {
  const lookupIds = Array.from(
    new Set(
      items
        .flatMap((i) => (i.variant_id ? [i.id, i.variant_id] : [i.id]))
        .filter((id) => POSTGRES_UUID_PATTERN.test(id))
    )
  );
  if (!lookupIds.length) return { products: [], variants: [] };
  const { data: products, error: productsError } = await supabase
    .from('products')
    .select(
      'id, name, price, stock, stock_quantity, manage_stock, weight_value, weight_unit'
    )
    .in('id', lookupIds)
    .eq('merchant_id', merchantId)
    .returns<AgenticProduct[]>();
  if (productsError) throw new Error('Failed to load checkout products');
  const { data: variants, error: variantsError } = await supabase
    .from('product_variants')
    .select(
      'id, merchant_id, product_id, price_override, stock_quantity, attributes, product:products!product_variants_product_id_fkey(name, price, manage_stock, weight_value, weight_unit)'
    )
    .in('id', lookupIds)
    .eq('merchant_id', merchantId)
    .returns<AgenticVariant[]>();
  if (variantsError)
    throw new Error('Failed to load checkout product variants');
  return { products: products || [], variants: variants || [] };
}
