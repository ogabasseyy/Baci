import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { isStorefrontProductVariantPublic } from '@/lib/is-storefront-product-variant-public';

export const SAVINGS_DEVICE_PRODUCT_SELECT = 'id, name, price, images, condition';

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

export const SavingsDeviceVariantSchema = z.object({
  archived_at: z.string().nullable().optional(),
  attributes: z.record(z.string(), z.string()).nullable().optional(),
  condition: z.string().nullable().optional(),
  deleted_at: z.string().nullable().optional(),
  id: z.string(),
  images: z.array(z.string()).nullable().optional(),
  is_active: z.boolean().nullable().optional(),
  is_inventory_anchor: z.boolean().nullable().optional(),
  price_override: z.union([z.number(), z.string()]).nullable().optional(),
  primary_image: z.string().nullable().optional(),
  sku: z.string().nullable().optional(),
  status: z.string().nullable().optional(),
});

export const SavingsDeviceProductSchema = z.object({
  condition: z.string().nullable().optional(),
  id: z.string(),
  images: z.array(z.string()).nullable().optional(),
  name: z.string(),
  price: z.union([z.number(), z.string()]),
  variants: z.array(SavingsDeviceVariantSchema).nullable().optional(),
});

export type SavingsDeviceProduct = z.infer<typeof SavingsDeviceProductSchema>;
export type SavingsDeviceVariant = z.infer<typeof SavingsDeviceVariantSchema>;

export type SavingsDeviceSnapshot = {
  condition: string | null;
  image: string | null;
  name: string;
  price: number;
  selectionStatus: 'exact';
  variantId: string | null;
  variantLabel: string | null;
};

export type SavingsDeviceResolution =
  | {
      cataloguePrice: number;
      ok: true;
      snapshot: SavingsDeviceSnapshot;
      targetAmount: number;
      variant: SavingsDeviceVariant | null;
      variantId: string | null;
    }
  | { code: string; error: string; ok: false; status: 400 | 404 | 409 };

const SavingsDeviceRpcVariantSchema = SavingsDeviceVariantSchema.extend({
  product_id: z.string(),
});

/**
 * Reads one active merchant product and hydrates its variants through the
 * storefront RPC. The product_variants table is merchant/staff-only under
 * RLS, so a direct relationship projection returns no variants to
 * customers; the SECURITY DEFINER RPC is the hydration boundary (same as
 * the savings catalogue) and already excludes inventory anchors. Returns
 * null when the product is missing or fails validation; throws transport
 * errors for the caller to map.
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
  const variantsResult = await supabase.rpc(
    'get_storefront_product_variants',
    { p_product_ids: [productId] }
  );
  if (variantsResult.error) {
    throw variantsResult.error;
  }
  const variants = z
    .array(SavingsDeviceRpcVariantSchema)
    .safeParse(variantsResult.data);
  const product =
    typeof productResult.data === 'object' && productResult.data !== null
      ? productResult.data
      : null;
  const parsed = SavingsDeviceProductSchema.safeParse({
    ...(product ?? {}),
    variants: variants.success
      ? variants.data.filter((variant) => variant.product_id === productId)
      : [],
  });
  return parsed.success ? parsed.data : null;
}

function formatVariantAxisLabel(axis: string) {
  const normalized = axis
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
  const labels: Record<string, string> = {
    ram: 'RAM',
    rom: 'ROM',
    sim_type: 'SIM Type',
    storage: 'Storage',
  };

  return (
    labels[normalized] ??
    normalized
      .split('_')
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ')
  );
}

function getVariantLabel(variant: SavingsDeviceVariant | null) {
  if (!variant) {
    return null;
  }

  const parts = Object.entries(variant.attributes ?? {})
    .filter(([, value]) => value)
    .map(([axis, value]) => `${formatVariantAxisLabel(axis)}: ${value}`);

  return parts.length > 0 ? parts.join(' · ') : variant.sku?.trim() || null;
}

function toPositiveAmount(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function getProductImage(
  product: SavingsDeviceProduct,
  variant: SavingsDeviceVariant | null
) {
  const variantImage =
    variant?.primary_image?.trim() || variant?.images?.[0]?.trim();
  return variantImage || product.images?.[0]?.trim() || null;
}

function buildProductSnapshot({
  product,
  targetAmount,
  variant,
}: {
  product: SavingsDeviceProduct;
  targetAmount: number;
  variant: SavingsDeviceVariant | null;
}): SavingsDeviceSnapshot {
  return {
    condition: variant?.condition ?? product.condition ?? null,
    image: getProductImage(product, variant),
    name: product.name,
    price: targetAmount,
    selectionStatus: 'exact',
    variantId: variant?.id ?? null,
    variantLabel: getVariantLabel(variant),
  };
}

export function resolveSavingsDeviceSelection({
  clientTargetAmount,
  product,
  variantId,
}: {
  clientTargetAmount?: number;
  product: SavingsDeviceProduct;
  variantId?: string | null;
}): SavingsDeviceResolution {
  // Same public-visibility rule as the storefront catalogue: an inactive,
  // non-active, deleted, or archived variant (or an internal inventory
  // anchor) can never back a savings goal, even when the caller retains its
  // UUID from before it was hidden.
  const variants = (product.variants ?? []).filter(
    isStorefrontProductVariantPublic
  );
  const hasVariants = variants.length > 0;
  const requestedVariantId = variantId?.trim() || null;

  if (hasVariants && !requestedVariantId) {
    return {
      code: 'SAVINGS_DEVICE_VARIANT_REQUIRED',
      error: 'Select the exact device variant to save for',
      ok: false,
      status: 400,
    };
  }

  const variant = requestedVariantId
    ? (variants.find((candidate) => candidate.id === requestedVariantId) ??
      null)
    : null;

  if (requestedVariantId && !variant) {
    return {
      code: 'SAVINGS_DEVICE_VARIANT_NOT_FOUND',
      error: 'Savings device variant is not available',
      ok: false,
      status: 404,
    };
  }

  const cataloguePrice = toPositiveAmount(
    variant?.price_override ?? product.price
  );
  if (cataloguePrice === null) {
    return {
      code: 'SAVINGS_DEVICE_PRICE_INVALID',
      error: 'Savings device price is not available',
      ok: false,
      status: 409,
    };
  }

  if (
    typeof clientTargetAmount === 'number' &&
    Number.isFinite(clientTargetAmount) &&
    clientTargetAmount < cataloguePrice
  ) {
    return {
      code: 'SAVINGS_DEVICE_PRICE_STALE',
      error: 'Savings target is below the current device price',
      ok: false,
      status: 409,
    };
  }

  const targetAmount =
    typeof clientTargetAmount === 'number' &&
    Number.isFinite(clientTargetAmount) &&
    clientTargetAmount >= cataloguePrice
      ? clientTargetAmount
      : cataloguePrice;

  return {
    cataloguePrice,
    ok: true,
    snapshot: buildProductSnapshot({
      product,
      targetAmount,
      variant,
    }),
    targetAmount,
    variant,
    variantId: variant?.id ?? null,
  };
}
