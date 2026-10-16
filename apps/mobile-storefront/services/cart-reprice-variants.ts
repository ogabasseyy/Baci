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

export type OfferParentRow = {
  id: string;
  has_condition_offers?: boolean | null;
  has_variants?: boolean | null;
  variant_model?: string | null;
};

type LiveVariantPresenceRow = {
  product_id: string;
};

// Rows per presence-probe page. Carts hold few offer products with few
// variants each, so one page almost always settles every candidate;
// pathological variant counts paginate instead of stalling.
const VARIANT_PRESENCE_PAGE_SIZE = 500;

/**
 * Product ids with at least one live non-anchor variant, via a single
 * batched call to the anon-safe `get_storefront_product_variants` RPC
 * (which already excludes anchors — exactly the order RPC's NOT EXISTS
 * semantics). Direct `product_variants` reads are intentionally
 * unavailable to storefront clients. One round trip covers the whole
 * cart however many offer products it holds; pagination only kicks in
 * past a full page of rows, with early exit once every candidate is
 * proven present. Probe failure fails open (`failed: true`) so callers
 * skip offer lines rather than guessing eligibility.
 */
async function fetchProductsWithLiveVariants(
  productIds: string[]
): Promise<{ present: Set<string>; failed: boolean }> {
  const present = new Set<string>();
  const unique = Array.from(
    new Set(
      productIds.filter(
        (id): id is string => typeof id === 'string' && id.length > 0
      )
    )
  );
  if (unique.length === 0) {
    return { present, failed: false };
  }
  const candidates = new Set(unique);
  let offset = 0;
  for (;;) {
    const { data, count, error } = await supabase
      .rpc(
        'get_storefront_product_variants',
        { p_product_ids: unique },
        { count: 'exact' }
      )
      .range(offset, offset + VARIANT_PRESENCE_PAGE_SIZE - 1);
    if (
      error ||
      typeof count !== 'number' ||
      !Number.isSafeInteger(count) ||
      count < 0 ||
      !Array.isArray(data)
    ) {
      log.warn('Reprice live-variant probe failed; skipping offer lines');
      return { present, failed: true };
    }
    for (const row of data as LiveVariantPresenceRow[]) {
      if (
        row &&
        typeof row.product_id === 'string' &&
        candidates.has(row.product_id)
      ) {
        present.add(row.product_id);
      }
    }
    if (present.size >= unique.length) {
      return { present, failed: false };
    }
    offset += VARIANT_PRESENCE_PAGE_SIZE;
    if (offset >= count) {
      return { present, failed: false };
    }
  }
}

/**
 * Offer-parent eligibility mirroring the order RPC's parent gate: the
 * flag on, a non-variant-bearing model, and zero live non-anchor
 * variants. Without this, reprice reports an exact offer available
 * from its live row while the RPC rejects the same cart with
 * `invalid_offer` (merchant disabled the flag or added variants
 * after the line was created).
 */
export async function fetchOfferEligibleParents(
  parents: OfferParentRow[],
  candidateProductIds: string[]
): Promise<{ eligible: Set<string>; failed: boolean }> {
  const eligible = new Set<string>();
  const candidates = new Set(
    candidateProductIds.filter(
      (id): id is string => typeof id === 'string' && id.length > 0
    )
  );
  if (candidates.size === 0) {
    return { eligible, failed: false };
  }
  const byId = new Map(parents.map((parent) => [parent.id, parent]));
  const { present, failed } = await fetchProductsWithLiveVariants([
    ...candidates,
  ]);
  if (failed) {
    return { eligible, failed: true };
  }
  for (const productId of candidates) {
    const parent = byId.get(productId);
    if (parent?.has_condition_offers !== true) {
      continue;
    }
    if (
      parent.has_variants === true ||
      (parent.variant_model ?? '') === 'sku_matrix'
    ) {
      continue;
    }
    if (present.has(productId)) {
      continue;
    }
    eligible.add(productId);
  }
  return { eligible, failed: false };
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
