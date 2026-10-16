import type { SupabaseClient } from '@supabase/supabase-js';

export class OrderConditionUnavailableError extends Error {
  constructor() {
    super('Condition offer unavailable');
    this.name = 'OrderConditionUnavailableError';
  }
}

type ConditionItem = {
  product_id?: string;
  variant_id?: string | null;
  condition?: string | null;
};
type ConditionPrice = {
  product_id: string;
  condition: string;
  price: number | string;
  status: string;
};

/** The database exposes only public order pricing, never private offer inventory. */
export async function loadOrderConditionPrices(
  items: ConditionItem[],
  merchantId: string,
  client: SupabaseClient,
  options?: { allowUnavailable?: boolean }
): Promise<Map<string, number>> {
  const productIds = [
    ...new Set(
      items
        .filter((item) => !item.variant_id && item.condition?.trim())
        .flatMap((item) => (item.product_id ? [item.product_id] : []))
    ),
  ];
  if (!productIds.length) return new Map();
  const { data, error } = await client.rpc('get_order_condition_prices', {
    p_merchant_id: merchantId,
    p_product_ids: productIds,
  });
  if (error)
    throw new Error('Unable to resolve condition prices', { cause: error });
  const prices = new Map<string, number>();
  for (const row of (data ?? []) as ConditionPrice[]) {
    if (
      row.status !== 'active' &&
      !options?.allowUnavailable &&
      items.some(
        (item) =>
          !item.variant_id &&
          item.product_id === row.product_id &&
          item.condition?.trim() === row.condition
      )
    )
      throw new OrderConditionUnavailableError();
    const price = Number(row.price);
    if (
      !productIds.includes(row.product_id) ||
      (row.status !== 'active' && !options?.allowUnavailable) ||
      !Number.isFinite(price) ||
      price < 0
    )
      continue;
    // Idempotent replays (allowUnavailable) price a since-deactivated
    // offer at its stored price so the recomputation matches the
    // original order and the RPC can replay it; fresh orders keep
    // failing closed above.
    prices.set(JSON.stringify([row.product_id, row.condition]), price);
  }
  return prices;
}

export function orderConditionPrice(
  prices: Map<string, number>,
  item: ConditionItem
): number | undefined {
  return item.variant_id
    ? undefined
    : prices.get(JSON.stringify([item.product_id, item.condition?.trim()]));
}
