import type { SupabaseClient } from '@supabase/supabase-js';
import { logger } from '@/lib/logger';

// Margin the AI negotiator promises to keep (see /api/storefront/negotiate).
const MIN_PROFIT_MARGIN = 0.1;

export interface NegotiatedLineForCostMonitor {
  productId: string;
  variantId?: string | null;
  catalogUnitPrice: number;
  clientUnitPrice: number;
  quantity?: number;
  negotiable: boolean;
}

// Cap per-order lookups so a crafted many-line order cannot fan out reads.
const MAX_MONITORED_LINES = 20;

type CostRow = { id: string; cost_price: number | string | null };
type VariantCostRow = CostRow & { product_id: string };

function positiveCost(value: number | string | null | undefined) {
  const cost = Number(value);
  return Number.isFinite(cost) && cost > 0 ? cost : null;
}

/**
 * Observation only. Log counts are CANDIDATE orders (a later payment/RPC
 * failure or an idempotent retry still logs), so size exposure from them
 * as an upper bound, not as realized losses. Lines beyond the per-order cap
 * and lines with no readable cost are not evaluated; both are reported as a
 * coverage-gap warning so they are not mistaken for zero exposure. Idempotent
 * offer replays re-charge a stored discount and are not re-observed (the
 * original order was observed when first placed). They are also an incomplete
 * sample: `after()` has no durable-job guarantee, so a timeout or load
 * shedding can drop a run and undercount breaches.
 * Logs when a below-catalog negotiated unit price falls
 * under the merchant's cost floor (cost * 1.1) or under cost itself.
 *
 * Never throws and never changes the order: the cost column is a private
 * merchant value, so a failed lookup must not break checkout. Cost figures
 * are deliberately NOT logged: only product/variant ids, the shopper-visible
 * prices and a belowCost boolean. A breach still implies a cost range, so
 * read this as 'no literal cost values' and keep log access privileged.
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
    const allDiscounted = lines.filter(
      (line) =>
        line.negotiable &&
        Number.isFinite(line.clientUnitPrice) &&
        Number.isFinite(line.catalogUnitPrice) &&
        line.clientUnitPrice < line.catalogUnitPrice
    );
    const discounted = allDiscounted.slice(0, MAX_MONITORED_LINES);
    const truncatedLines = allDiscounted.length - discounted.length;
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
    if (error || !data) {
      // Make a lost cost_price grant/RLS visible: zero breaches must not be
      // indistinguishable from zero visibility. No cost values are logged.
      logger.warn({
        message: 'Negotiation cost-floor monitor could not read product cost',
        merchantId,
        code: (error as { code?: string } | null)?.code ?? null,
      });
      return;
    }
    const productCost = new Map(
      data.map((row) => [row.id, positiveCost(row.cost_price)])
    );

    // A variant's own cost wins over the parent's (same precedence as the
    // purchase analytics); a missing variant cost falls back to the parent.
    let variantLookupErrorCode: string | null = null;
    const variantCost = new Map<string, number | null>();
    const variantProduct = new Map<string, string>();
    if (variantIds.length > 0) {
      const { data: variants, error: variantError } = await supabase
        .from('product_variants')
        .select('id, product_id, cost_price')
        .eq('merchant_id', merchantId)
        .in('id', variantIds)
        .overrideTypes<VariantCostRow[], { merge: false }>();
      if (variantError) {
        variantLookupErrorCode =
          (variantError as { code?: string }).code ?? 'unknown';
      }
      if (!variantError && variants) {
        for (const row of variants) {
          variantCost.set(row.id, positiveCost(row.cost_price));
          variantProduct.set(row.id, row.product_id);
        }
      }
    }

    const breaches: Array<{
      productId: string;
      variantId: string | null;
      quantity: number | null;
      catalogUnitPrice: number;
      negotiatedUnitPrice: number;
      belowCost: boolean;
    }> = [];
    let unreadableVariantLines = 0;
    let unreadableProductLines = 0;
    for (const line of discounted) {
      if (line.variantId && !variantCost.has(line.variantId)) {
        // Shopper-scoped clients cannot read variant rows under RLS: report
        // the gap instead of silently comparing against the parent cost.
        unreadableVariantLines += 1;
        continue;
      }
      if (
        line.variantId &&
        variantProduct.get(line.variantId) !== line.productId
      ) {
        // Foreign variant: its cost must not be used, but the line must not
        // vanish from the coverage counts either.
        unreadableVariantLines += 1;
        continue;
      }
      const cost =
        (line.variantId ? variantCost.get(line.variantId) : null) ??
        productCost.get(line.productId) ??
        null;
      if (cost === null) {
        // No readable positive cost (row filtered out, null or zero cost).
        unreadableProductLines += 1;
        continue;
      }
      // Compare in whole minor units so an exact 10% margin is not flagged
      // by floating-point error (e.g. 100 * 1.1 = 110.00000000000001).
      const floorMinor = Math.round(cost * (1 + MIN_PROFIT_MARGIN) * 100);
      const priceMinor = Math.round(line.clientUnitPrice * 100);
      if (priceMinor >= floorMinor) continue;
      breaches.push({
        productId: line.productId,
        variantId: line.variantId ?? null,
        quantity: line.quantity ?? null,
        catalogUnitPrice: line.catalogUnitPrice,
        negotiatedUnitPrice: line.clientUnitPrice,
        belowCost: priceMinor < Math.round(cost * 100),
      });
    }
    if (unreadableVariantLines > 0) {
      logger.warn({
        message: 'Negotiation cost-floor monitor could not read variant cost',
        merchantId,
        unreadableVariantLines,
        variantLookupErrorCode,
      });
    }
    if (truncatedLines > 0 || unreadableProductLines > 0) {
      logger.warn({
        message: 'Negotiation cost-floor monitor coverage gap',
        merchantId,
        truncatedLines,
        unreadableProductLines,
      });
    }
    // One aggregated breach entry per order (multi-line orders must not spam
    // logs), plus at most two coverage-gap warnings above.
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
