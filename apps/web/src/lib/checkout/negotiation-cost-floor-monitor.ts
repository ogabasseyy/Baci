import type { SupabaseClient } from '@supabase/supabase-js';
import { logger } from '@/lib/logger';

// Margin the AI negotiator promises to keep (see /api/storefront/negotiate).
const MIN_PROFIT_MARGIN = 0.1;

export interface NegotiatedLineForCostMonitor {
  productId: string;
  variantId?: string | null;
  catalogUnitPrice: number;
  clientUnitPrice: number;
  negotiable: boolean;
}

type CostRow = { id: string; cost_price: number | string | null };
type VariantCostRow = CostRow & { product_id: string };

function positiveCost(value: number | string | null | undefined) {
  const cost = Number(value);
  return Number.isFinite(cost) && cost > 0 ? cost : null;
}

/**
 * Observation only. Log counts are CANDIDATE orders (a later payment/RPC
 * failure or an idempotent retry still logs), so size exposure from them
 * as an upper bound, not as realized losses.
 * Logs when a below-catalog negotiated unit price falls
 * under the merchant's cost floor (cost * 1.1) or under cost itself.
 *
 * Never throws and never changes the order: the cost column is a private
 * merchant value, so a failed lookup must not break checkout. Cost figures
 * are deliberately NOT logged: only product/variant ids, the shopper-visible
 * prices and a belowCost boolean.
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
    const variantIds = Array.from(
      new Set(
        discounted.map((l) => l.variantId).filter((id): id is string => !!id)
      )
    );
    const { data, error } = await supabase
      .from('products')
      .select('id, cost_price')
      .eq('merchant_id', merchantId)
      .in('id', productIds)
      .overrideTypes<CostRow[], { merge: false }>();
    if (error || !data) return;
    const productCost = new Map(
      data.map((row) => [row.id, positiveCost(row.cost_price)])
    );

    // A variant's own cost wins over the parent's (same precedence as the
    // purchase analytics); a missing variant cost falls back to the parent.
    const variantCost = new Map<string, number | null>();
    if (variantIds.length > 0) {
      const { data: variants, error: variantError } = await supabase
        .from('product_variants')
        .select('id, product_id, cost_price')
        .eq('merchant_id', merchantId)
        .in('id', variantIds)
        .overrideTypes<VariantCostRow[], { merge: false }>();
      if (!variantError && variants) {
        for (const row of variants) {
          variantCost.set(row.id, positiveCost(row.cost_price));
        }
      }
    }

    const breaches: Array<{
      productId: string;
      variantId: string | null;
      catalogUnitPrice: number;
      negotiatedUnitPrice: number;
      belowCost: boolean;
    }> = [];
    for (const line of discounted) {
      const cost =
        (line.variantId ? variantCost.get(line.variantId) : null) ??
        productCost.get(line.productId) ??
        null;
      if (cost === null) continue;
      if (line.clientUnitPrice >= cost * (1 + MIN_PROFIT_MARGIN)) continue;
      breaches.push({
        productId: line.productId,
        variantId: line.variantId ?? null,
        catalogUnitPrice: line.catalogUnitPrice,
        negotiatedUnitPrice: line.clientUnitPrice,
        belowCost: line.clientUnitPrice < cost,
      });
    }
    // One aggregated entry per order (multi-line orders must not spam logs).
    // Candidates only: the order may still fail later, and prices here are
    // the shopper-visible ones, never the merchant cost.
    if (breaches.length > 0) {
      logger.warn({
        message: 'Negotiated order candidate priced under merchant cost floor',
        merchantId,
        breaches,
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
