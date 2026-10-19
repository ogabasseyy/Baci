import type { SupabaseClient } from '@supabase/supabase-js';
import {
  loadOrderConditionPrices,
  OrderConditionUnavailableError,
} from '@/lib/checkout/order-condition-prices';

export type ConditionLaneItem = {
  product_id: string;
  variant_id?: string;
  condition?: string;
};

export function conditionLaneKey(productId: string, condition: string): string {
  return JSON.stringify([productId, condition.trim()]);
}

/**
 * Resolves condition-offer prices with per-line isolation: one inactive
 * offer must not reject every other condition lane in the request, so a
 * bulk failure falls back to resolving each lane on its own and records
 * only the offending lanes as unavailable.
 */
export async function loadConditionPricesIsolated(
  client: SupabaseClient,
  merchantId: string,
  items: ConditionLaneItem[]
): Promise<{ prices: Map<string, number>; unavailable: Set<string> }> {
  const lanes = items.filter(
    (item) => !item.variant_id && item.condition && item.condition !== 'new'
  );
  if (!lanes.length) return { prices: new Map(), unavailable: new Set() };
  try {
    const prices = await loadOrderConditionPrices(lanes, merchantId, client);
    return { prices, unavailable: new Set() };
  } catch (error) {
    if (!(error instanceof OrderConditionUnavailableError)) throw error;
  }
  const prices = new Map<string, number>();
  const unavailable = new Set<string>();
  const seen = new Set<string>();
  for (const lane of lanes) {
    const key = conditionLaneKey(lane.product_id, lane.condition as string);
    if (seen.has(key)) continue;
    seen.add(key);
    try {
      const single = await loadOrderConditionPrices([lane], merchantId, client);
      for (const [priceKey, price] of single) prices.set(priceKey, price);
    } catch (error) {
      if (!(error instanceof OrderConditionUnavailableError)) throw error;
      unavailable.add(key);
    }
  }
  return { prices, unavailable };
}
