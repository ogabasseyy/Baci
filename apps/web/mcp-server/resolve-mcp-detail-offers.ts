import type { SupabaseClient } from '@supabase/supabase-js';
import { coerceOfferAuthorityRow } from '@baci/shared/lib';

export interface McpDetailOfferRow {
  offer_id: string;
  condition: string;
  price: number;
  compare_at_price: number | null;
  stock_quantity: number;
  grade: string | null;
  condition_notes: string | null;
}

/**
 * Condition offers for the MCP detail surface through the single
 * offer-resolution authority. Discovery-side ad-gate: unshaped
 * parents are not advertised even though checkout would stage their
 * rows. Rows without a finite price are skipped, never zero-priced.
 */
export async function resolveMcpDetailOffers({
  supabase,
  product,
  merchantId,
}: {
  supabase: SupabaseClient;
  product: { id: string; condition: string | null };
  merchantId: string;
}): Promise<{ offers: McpDetailOfferRow[]; lookupFailed: boolean }> {
  const { data: offerData, error: offerError } = await supabase.rpc(
    'get_storefront_offer_resolution',
    {
      p_merchant_id: merchantId,
      p_product_ids: [product.id],
    }
  );
  if (offerError) {
    console.error('Failed to fetch public product offers:', offerError);
    return { offers: [], lookupFailed: true };
  }
  const offers = ((offerData ?? []) as unknown[]).flatMap((row) => {
    const resolution = coerceOfferAuthorityRow(row);
    // Case-insensitive: the resolution id is canonical
    // (lowercase) while the caller id may spell UUID hex
    // uppercase.
    if (
      !resolution ||
      resolution.productId !== product.id.toLowerCase() ||
      resolution.priceBasis === null ||
      resolution.parentEligible !== true
    )
      return [];
    // Display prices from the live basis and availability from the
    // allocatable stock (policy-capped, parent-inherited): exactly
    // what checkout enforces. Unbounded rows stay purchasable.
    return [
      {
        offer_id: resolution.offerId,
        condition: resolution.condition ?? product.condition ?? 'new',
        price: resolution.priceBasis,
        compare_at_price: resolution.compareAtPrice ?? null,
        // Null is unbounded only for serialized_then_unlimited;
        // any other policy with a missing allocation fails closed
        // at zero (the SQL legacy arm always coalesces, so null
        // there means a partial projection).
        stock_quantity:
          resolution.allocatableStock ??
          (resolution.effectivePolicy === 'serialized_then_unlimited'
            ? Number.MAX_SAFE_INTEGER
            : 0),
        grade: resolution.grade ?? null,
        condition_notes: resolution.conditionNotes ?? null,
      },
    ];
  });
  return { offers, lookupFailed: false };
}
