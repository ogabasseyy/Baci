import { MAX_AUTO_NEGOTIATION_DISCOUNT_RATE } from '@baci/shared/lib';
import type { SupabaseClient } from '@supabase/supabase-js';
import { CanonicalOrderSubtotalLoadError } from './canonical-order-subtotal';

// Same ±1 NGN rounding tolerance as eligible-line-discount.ts.
const PRICE_TOLERANCE = 1;

export interface CostFloorCandidateLine {
  productId: string;
  catalogUnitPrice: number;
  clientUnitPrice: number;
  negotiable: boolean;
}

/**
 * True when a discounted line is priced under the merchant cost floor
 * (cost * 1.1) and would therefore sell below the 10% margin.
 *
 * Cost is never read here: `get_negotiation_cost_floor_price` returns
 * GREATEST(cost * 1.1, price * 0.98). The 2% band is enforced separately, so
 * only the case where cost dominates (floor above price * 0.98) matters. A
 * product whose cost * 1.1 exceeds its price therefore accepts no discount.
 *
 * Only discounted negotiable lines are looked up, so a full-price order never
 * depends on this check. A failed lookup throws (the route treats it like any
 * other pricing-load failure and the shopper can retry) rather than letting an
 * unchecked discount through.
 */
export async function hasCostFloorBreach({
  supabase,
  merchantId,
  lines,
  parentPrices,
}: {
  supabase: SupabaseClient;
  merchantId: string;
  lines: CostFloorCandidateLine[];
  parentPrices: Map<string, number>;
}): Promise<boolean> {
  const discounted = lines.filter(
    (line) =>
      line.negotiable &&
      Number.isFinite(line.clientUnitPrice) &&
      line.clientUnitPrice < line.catalogUnitPrice
  );
  const productIds = Array.from(new Set(discounted.map((l) => l.productId)));
  const floors = new Map<string, number | null>();
  await Promise.all(
    productIds.map(async (productId) => {
      const { data, error } = await supabase.rpc(
        'get_negotiation_cost_floor_price',
        { p_product_id: productId, p_merchant_id: merchantId }
      );
      if (error) {
        throw new CanonicalOrderSubtotalLoadError(
          'Unable to load negotiation cost floor',
          { cause: error },
          (error as { code?: string }).code
        );
      }
      const floor = data === null || data === undefined ? null : Number(data);
      floors.set(
        productId,
        floor !== null && Number.isFinite(floor) ? floor : null
      );
    })
  );

  return discounted.some((line) => {
    const floor = floors.get(line.productId);
    const parentPrice = parentPrices.get(line.productId);
    if (floor == null || parentPrice == null) return false;
    const costDominates =
      floor > parentPrice * (1 - MAX_AUTO_NEGOTIATION_DISCOUNT_RATE);
    return costDominates && line.clientUnitPrice < floor - PRICE_TOLERANCE;
  });
}
