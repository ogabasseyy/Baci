import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import {
  type SavingsDeviceProduct,
  SavingsDeviceProductSchema,
  SavingsDeviceVariantSchema,
} from '@/schemas/customer-savings-device';

export const SAVINGS_DEVICE_PRODUCT_SELECT =
  'id, name, price, images, condition';

type SavingsDeviceEqChain = {
  eq: (column: string, value: string) => SavingsDeviceEqChain;
  maybeSingle: () => PromiseLike<{ data: unknown; error: unknown }>;
};

export type SavingsDeviceQueryClient = {
  from: (table: 'products') => {
    select: (columns: string) => SavingsDeviceEqChain;
  };
  rpc: (
    fn: 'get_storefront_product_variants',
    params: { p_product_ids: string[] }
  ) => PromiseLike<{ data: unknown; error: unknown }>;
};

/**
 * Narrows a Supabase client to the savings-device query surface. The
 * concrete client cannot satisfy SavingsDeviceQueryClient structurally
 * (its overloaded rpc overflows generic instantiation), so adapt it
 * explicitly instead of casting at each call site.
 */
export function asSavingsDeviceQueryClient(
  supabase: SupabaseClient
): SavingsDeviceQueryClient {
  return {
    from: (table) => ({
      select: (columns) => {
        const query = supabase.from(table).select(columns);
        const chain: SavingsDeviceEqChain = {
          eq: (column, value) => {
            query.eq(column, value);
            return chain;
          },
          maybeSingle: async () => {
            const { data, error } = await query.maybeSingle();
            return { data, error };
          },
        };
        return chain;
      },
    }),
    rpc: (fn, params) => supabase.rpc(fn, params),
  };
}

const SavingsDeviceRpcVariantSchema = SavingsDeviceVariantSchema.extend({
  product_id: z.string(),
});

/**
 * Reads one active merchant product and hydrates its variants through the
 * storefront RPC. The product_variants table is merchant/staff-only under
 * RLS, so a direct relationship projection returns no variants to
 * customers; the SECURITY DEFINER RPC is the hydration boundary (same as
 * the savings catalogue) and already excludes inventory anchors. Returns
 * null when the product is missing or fails validation — including an
 * invalid variant payload, which must never silently downgrade a
 * variant-bearing product to variantless; throws transport errors for the
 * caller to map.
 */
export async function readSavingsDeviceProduct({
  merchantId,
  productId,
  supabase,
}: {
  merchantId: string;
  productId: string;
  supabase: SavingsDeviceQueryClient;
}): Promise<SavingsDeviceProduct | null> {
  const productResult = await supabase
    .from('products')
    .select(SAVINGS_DEVICE_PRODUCT_SELECT)
    .eq('merchant_id', merchantId)
    .eq('id', productId)
    .eq('status', 'active')
    .maybeSingle();
  if (productResult.error) {
    throw productResult.error;
  }
  const variantsResult = await supabase.rpc('get_storefront_product_variants', {
    p_product_ids: [productId],
  });
  if (variantsResult.error) {
    throw variantsResult.error;
  }
  const variants = z
    .array(SavingsDeviceRpcVariantSchema)
    .safeParse(variantsResult.data);
  if (!variants.success) return null;
  const product =
    typeof productResult.data === 'object' && productResult.data !== null
      ? productResult.data
      : null;
  const parsed = SavingsDeviceProductSchema.safeParse({
    ...(product ?? {}),
    variants: variants.data.filter(
      (variant) => variant.product_id === productId
    ),
  });
  return parsed.success ? parsed.data : null;
}
