import type { SupabaseClient } from '@supabase/supabase-js';
import { resolveMcpOfferStock } from './resolve-mcp-offer-stock';
import { selectMcpOfferResolutions } from './select-mcp-offer-resolutions';

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
  const offers = selectMcpOfferResolutions(offerData, product.id).map(
    (resolution) => ({
      offer_id: resolution.offerId,
      condition: resolution.condition ?? product.condition ?? 'new',
      price: resolution.priceBasis as number,
      compare_at_price: resolution.compareAtPrice ?? null,
      stock_quantity: resolveMcpOfferStock(resolution),
      grade: resolution.grade ?? null,
      condition_notes: resolution.conditionNotes ?? null,
    })
  );
  return { offers, lookupFailed: false };
}
