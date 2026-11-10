import type { SupabaseClient } from '@supabase/supabase-js';
import { logger } from '@/lib/logger';

// Margin the AI negotiator promises to keep (see /api/storefront/negotiate).
const MIN_PROFIT_MARGIN = 0.1;

export interface NegotiatedLineForCostMonitor {
  productId: string;
  catalogUnitPrice: number;
  clientUnitPrice: number;
  negotiable: boolean;
}

type CostRow = { id: string; cost_price: number | string | null };

/**
 * Observation only. Logs when a below-catalog negotiated unit price falls
 * under the merchant's cost floor (cost * 1.1) or under cost itself.
 *
 * Never throws and never changes the order: the cost column is a private
 * merchant value, so a failed lookup must not break checkout. Cost figures
 * are deliberately NOT logged, only the product id and the booleans.
 */
export async function monitorNegotiationCostFloor({
  supabase,
  merchantId,
  lines,
}: {
  supabase: SupabaseClient;
  merchantId: string;
  lines: NegotiatedLineForCostMonitor[];
}): Promise<void> {
  try {
    const discounted = lines.filter(
      (line) =>
        line.negotiable &&
        Number.isFinite(line.clientUnitPrice) &&
        Number.isFinite(line.catalogUnitPrice) &&
        line.clientUnitPrice < line.catalogUnitPrice
    );
    if (discounted.length === 0) return;

    const productIds = Array.from(new Set(discounted.map((l) => l.productId)));
    const { data, error } = await supabase
      .from('products')
      .select('id, cost_price')
      .eq('merchant_id', merchantId)
      .in('id', productIds)
      .overrideTypes<CostRow[], { merge: false }>();
    if (error || !data) return;

    const costById = new Map(
      data.map((row) => [row.id, Number(row.cost_price)])
    );
    for (const line of discounted) {
      const cost = costById.get(line.productId);
      if (cost === undefined || !Number.isFinite(cost) || cost <= 0) continue;
      const belowCostFloor =
        line.clientUnitPrice < cost * (1 + MIN_PROFIT_MARGIN);
      if (!belowCostFloor) continue;
      logger.warn({
        message: 'Negotiated order line priced under merchant cost floor',
        merchantId,
        productId: line.productId,
        catalogUnitPrice: line.catalogUnitPrice,
        negotiatedUnitPrice: line.clientUnitPrice,
        belowCostFloor,
        belowCost: line.clientUnitPrice < cost,
      });
    }
  } catch (error) {
    logger.warn({
      message: 'Negotiation cost-floor monitor failed',
      merchantId,
      error,
    });
  }
}
