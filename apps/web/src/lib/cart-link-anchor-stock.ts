import type { SupabaseClient } from '@supabase/supabase-js';
import {
  resolveSerializedAnchorStock,
  type SerializedAnchorStock,
} from './serialized-anchor-stock';

export interface CartLinkAnchorStockOptions {
  supabase: Pick<SupabaseClient, 'rpc'>;
  merchantId: string;
  products: ReadonlyArray<{ id: string; has_variants?: boolean | null }>;
}

/**
 * Serialized-inventory projection for cart-link transfer, shared with the
 * MCP handoff: a chat save and this website recheck must evaluate the same
 * anchor policy for the same product, or a unit sold in between is still
 * added here (strict) or a purchasable line is wrongly rejected
 * (then-unlimited). A lookup failure keeps stored stock, failing open
 * exactly like the MCP path; rejections stay retryable via the rewritten
 * URL. Extracted from cart-link-transfer to hold the 300-line file budget.
 */
export async function fetchCartLinkAnchorStock(
  options: CartLinkAnchorStockOptions
): Promise<SerializedAnchorStock> {
  const anchorStock = await resolveSerializedAnchorStock({
    supabase: options.supabase,
    merchantId: options.merchantId,
    productIds: options.products
      .filter((product) => product.has_variants !== true)
      .map((product) => product.id),
  });
  if (anchorStock.failed) {
    console.error(
      'Failed to fetch serialized anchor policy for cart transfer:',
      anchorStock.error
    );
  }
  return anchorStock;
}
