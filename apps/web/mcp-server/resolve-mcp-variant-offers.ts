import type { SupabaseClient } from '@supabase/supabase-js';
import { resolveMcpOfferStock } from './resolve-mcp-offer-stock';
import { selectMcpOfferResolutions } from './select-mcp-offer-resolutions';

export interface McpVariantOfferRow {
  offer_id: string;
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
  const offers = selectMcpOfferResolutions(data, productId).map(
    (resolution) => ({
      // Exact identity: MCP consumers submit the offer by id rather
      // than an ambiguous condition.
      offer_id: resolution.offerId,
      condition: resolution.condition ?? 'new',
      grade: resolution.grade ?? null,
      price: resolution.priceBasis as number,
      stock_quantity: resolveMcpOfferStock(resolution),
      condition_notes: resolution.conditionNotes ?? null,
    })
  );
  return { offers, lookupFailed: false };
}
