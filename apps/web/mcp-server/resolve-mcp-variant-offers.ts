import type { SupabaseClient } from '@supabase/supabase-js';
import { coerceOfferAuthorityRow } from '@baci/shared/lib';

export interface McpVariantOfferRow {
  condition: string;
  grade: string | null;
  price: number;
  stock_quantity: number;
  condition_notes: string | null;
}

/**
 * Condition offers for the MCP variants surface through the single
 * offer-resolution authority. Discovery-side ad-gate: unshaped
 * parents are not advertised even though checkout would stage their
 * rows. Rows without a finite price are skipped, never zero-priced.
 */
export async function resolveMcpVariantOffers({
  supabase,
  productId,
  merchantId,
}: {
  supabase: SupabaseClient;
  productId: string;
  merchantId: string;
}): Promise<{ offers: McpVariantOfferRow[]; lookupFailed: boolean }> {
  const { data, error } = await supabase.rpc(
    'get_storefront_offer_resolution',
    {
      p_merchant_id: merchantId,
      p_product_ids: [productId],
    }
  );
  if (error) {
    console.error('Failed to fetch public product offers:', error);
    return { offers: [], lookupFailed: true };
  }
  const offers = ((data ?? []) as unknown[]).flatMap((row) => {
    const resolution = coerceOfferAuthorityRow(row);
    // Case-insensitive: the resolution id is canonical
    // (lowercase) while the caller id may spell UUID hex
    // uppercase.
    if (
      !resolution ||
      resolution.productId !== productId.toLowerCase() ||
      resolution.priceBasis === null ||
      resolution.parentEligible !== true
    )
      return [];
    // Display prices from the live basis and availability from the
    // allocatable stock (policy-capped, parent-inherited): exactly
    // what checkout enforces. Unbounded rows stay purchasable.
    return [
      {
        condition: resolution.condition ?? 'new',
        grade: resolution.grade ?? null,
        price: resolution.priceBasis,
        // Null is unbounded only for serialized_then_unlimited;
        // any other policy with a missing allocation fails closed
        // at zero (the SQL legacy arm always coalesces, so null
        // there means a partial projection).
        stock_quantity:
          resolution.allocatableStock ??
          (resolution.effectivePolicy === 'serialized_then_unlimited'
            ? Number.MAX_SAFE_INTEGER
            : 0),
        condition_notes: resolution.conditionNotes ?? null,
      },
    ];
  });
  return { offers, lookupFailed: false };
}
