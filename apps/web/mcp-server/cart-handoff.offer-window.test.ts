import type { SupabaseClient } from '@supabase/supabase-js';
import { expect, it } from 'vitest';
import { prepareCartHandoff } from './cart-handoff';

const lower = '11111111-1111-4111-8111-111111111111';

interface OfferRow {
  product_id: string;
  merchant_id: string;
  status: string;
  condition: string;
  id: string;
  stock_quantity: number;
}

// Faithful in-memory product_offers: applies eq/order/limit the way
// PostgREST does, so the tests prove the window instead of the mock.
function offersTable(rows: OfferRow[]) {
  const state = {
    eqs: [] as [string, unknown][],
    orders: [] as string[],
    limit: Number.POSITIVE_INFINITY,
  };
  const chain: Record<string, (...args: unknown[]) => unknown> = {};
  chain.select = () => chain;
  chain.eq = (column: unknown, value: unknown) => {
    state.eqs.push([column as string, value]);
    return chain;
  };
  chain.order = (column: unknown) => {
    state.orders.push(column as string);
    return chain;
  };
  chain.limit = (count: unknown) => {
    state.limit = count as number;
    return chain;
  };
  chain.then = (resolve: (value: unknown) => unknown) => {
    let out = rows.filter((row) =>
      state.eqs.every(
        (pair) =>
          (row as unknown as Record<string, unknown>)[pair[0]] === pair[1]
      )
    );
    if (state.orders.length > 0)
      out = [...out].sort((left, right) => {
        for (const column of state.orders) {
          const compared = String(
            (left as unknown as Record<string, unknown>)[column]
          ).localeCompare(
            String((right as unknown as Record<string, unknown>)[column])
          );
          if (compared !== 0) return compared;
        }
        return 0;
      });
    return Promise.resolve({ data: out.slice(0, state.limit), error: null }).then(
      resolve
    );
  };
  return { chain, state };
}

function offer(index: number, stock: number): OfferRow {
  return {
    product_id: lower,
    merchant_id: 'merchant',
    status: 'active',
    condition: 'new',
    id: `offer-${String(index).padStart(2, '0')}`,
    stock_quantity: stock,
  };
}

function product() {
  return {
    data: {
      name: 'Phone',
      slug: 'phone',
      price: 100,
      manage_stock: true,
      stock_quantity: 0,
      has_variants: false,
      has_condition_offers: true,
    },
    error: null,
  };
}

function clientFor(offers: ReturnType<typeof offersTable>['chain']) {
  return {
    from: (table: string) => {
      if (table === 'products')
        return { select: () => ({ eq: () => ({ eq: () => ({ eq: () => ({ single: async () => product() }) }) }) }) };
      return offers;
    },
    rpc: async () => ({ data: [], error: null }),
  } as unknown as SupabaseClient;
}

function check(supabase: SupabaseClient) {
  return prepareCartHandoff({
    supabase,
    merchantId: 'merchant',
    productId: lower,
    quantity: 1,
    formatPrice: String,
  });
}

it('windows offers by condition and id before the stock check', async () => {
  const offers = offersTable([offer(1, 0)]);
  await check(clientFor(offers.chain));
  expect(offers.state.orders).toEqual(['condition', 'id']);
  expect(offers.state.limit).toBe(16);
});

it('reports unavailable when only the 17th offer is stocked', async () => {
  const rows = Array.from({ length: 16 }, (_, index) => offer(index + 1, 0));
  rows.push(offer(17, 5));
  const result = await check(clientFor(offersTable(rows).chain));
  // The stocked row falls outside the PDP's 16-offer window: selection
  // would advertise an option the PDP cannot fulfill.
  expect(result.structuredContent).toMatchObject({
    success: false,
    product_unavailable: true,
  });
});

it('selects options when a windowed offer is stocked', async () => {
  const rows = Array.from({ length: 15 }, (_, index) => offer(index + 1, 0));
  rows.push(offer(16, 5));
  const result = await check(clientFor(offersTable(rows).chain));
  expect(result.structuredContent).toMatchObject({
    success: false,
    requires_variant_selection: true,
    product_id: lower,
  });
});
