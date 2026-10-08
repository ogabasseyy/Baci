import type { SupabaseClient } from '@supabase/supabase-js';
import { SERIALIZED_THEN_UNLIMITED_STOCK_QUANTITY } from './hydrate-public-products';

export interface SerializedAnchorProjection {
  /** Projected manage_stock: strict anchors gate on units, then-unlimited never gates. */
  manageStock: boolean;
  /** Projected stock_quantity in units, or the unlimited sentinel. */
  stockQuantity: number;
}

export interface SerializedAnchorStock {
  /** Projections keyed by lowercase product id. */
  projections: Map<string, SerializedAnchorProjection>;
  /** True when the lookup failed: the caller keeps stored stock. */
  failed: boolean;
  /** The RPC failure, for the caller's log line. */
  error?: unknown;
}

interface AnchorPolicyRow {
  product_id: string;
  effective_policy: string;
  available_units: number | null;
}

/**
 * Resolves serialized-inventory anchor policies for simple products through
 * the same RPC search hydration uses. A serialized_strict anchor gates an
 * otherwise unmanaged parent on its available units, while
 * serialized_then_unlimited resolves empty anchors to the unlimited
 * sentinel instead of rejecting a purchasable line. Absence of a row means
 * no serialized policy (the caller keeps stored stock); an RPC failure
 * returns failed:true so the caller keeps stored stock and marks the
 * outcome transient/retryable instead of typed-unavailable, failing open
 * exactly like search.
 */
export async function resolveSerializedAnchorStock(options: {
  supabase: Pick<SupabaseClient, 'rpc'>;
  merchantId: string;
  productIds: string[];
}): Promise<SerializedAnchorStock> {
  const projections = new Map<string, SerializedAnchorProjection>();
  if (options.productIds.length === 0) return { projections, failed: false };
  try {
    const { data: anchors, error } = await options.supabase.rpc(
      'get_mcp_search_serialized_anchor_policies',
      {
        p_product_ids: options.productIds,
        p_merchant_id: options.merchantId,
      }
    );
    if (error) throw error;
    for (const row of (anchors ?? []) as AnchorPolicyRow[]) {
      if (
        typeof row.product_id !== 'string' ||
        (row.effective_policy !== 'serialized_strict' &&
          row.effective_policy !== 'serialized_then_unlimited')
      )
        continue;
      // Null means zero anchored units; anything else non-numeric is junk
      // and fails safe to zero (a strict anchor then gates the line).
      const units =
        typeof row.available_units === 'number' ? row.available_units : 0;
      // Keyed lowercase: UUID text is case-insensitive, and callers look
      // up with canonical lowercase ids.
      const key = row.product_id.toLowerCase();
      if (row.effective_policy === 'serialized_strict') {
        projections.set(key, {
          manageStock: true,
          stockQuantity: units,
        });
      } else {
        projections.set(key, {
          manageStock: false,
          stockQuantity:
            units === 0 ? SERIALIZED_THEN_UNLIMITED_STOCK_QUANTITY : units,
        });
      }
    }
    return { projections, failed: false };
  } catch (error) {
    return { projections, failed: true, error };
  }
}
