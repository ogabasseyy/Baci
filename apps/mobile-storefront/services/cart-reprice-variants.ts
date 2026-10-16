import { createLogger } from '@/lib/logger';
import { supabase } from '@/lib/supabase';
import type { CartItem } from '@/stores/cart-store';

const log = createLogger('CartReprice');

type VariantOverrideRow = {
  id: string;
  product_id: string;
  price_override: number | string | null;
};

export type VariantOverrideEntry = {
  price: number | null;
  productId: string;
};

export type VariantOverrideMap = Map<string, VariantOverrideEntry>;

/**
 * Variant overrides via the same RLS-safe RPC the order validation uses.
 * Keeps the owning product_id alongside the price so a stale/corrupt cart
 * line cannot be repriced with an override that belongs to another product.
 * Fails open with `failed: true` so callers skip variant lines rather than
 * silently falling back to base prices — a variant with a price_override
 * would be rewritten to the wrong unit price.
 */
export async function fetchVariantOverrides(
  variantIds: string[]
): Promise<{ overrides: VariantOverrideMap; failed: boolean }> {
  const overrides: VariantOverrideMap = new Map();
  if (variantIds.length === 0) {
    return { overrides, failed: false };
  }
  const { data: variants, error: variantsError } = (await supabase.rpc(
    'get_order_variant_overrides',
    { p_variant_ids: variantIds }
  )) as unknown as {
    data: VariantOverrideRow[] | null;
    error: { message: string } | null;
  };
  if (variantsError) {
    log.warn('Reprice variant override lookup failed; skipping variant lines', {
      error: variantsError.message,
    });
    return { overrides, failed: true };
  }
  for (const variant of variants ?? []) {
    overrides.set(variant.id, {
      price:
        variant.price_override == null ? null : Number(variant.price_override),
      productId: variant.product_id,
    });
  }
  return { overrides, failed: false };
}

/**
 * Authoritative unit price for a variant line: `variant.price_override ??
 * product.price`. Returns null when the variant row is missing
 * (deleted/inactive) or belongs to another product after a successful
 * lookup: the order RPC joins variants with `v.product_id = p.id` and
 * rejects the whole order with `invalid_variant`. Falling back to the base
 * price would sail past the removal alert and fail at checkout. A row that
 * exists with a null override still inherits the parent price. (Lookup
 * failure already skipped these lines before this is called.)
 */
export function resolveVariantLinePrice(
  item: Pick<CartItem, 'variant_id' | 'product_id'>,
  overrides: VariantOverrideMap,
  basePrice: number
): number | null {
  const row = item.variant_id ? overrides.get(item.variant_id) : undefined;
  if (!row || row.productId !== item.product_id) {
    return null;
  }
  return row.price ?? basePrice;
}
