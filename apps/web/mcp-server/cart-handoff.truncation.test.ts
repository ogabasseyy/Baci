import type { SupabaseClient } from '@supabase/supabase-js';
import { expect, it } from 'vitest';
import { prepareCartHandoff } from './cart-handoff';

type QueryResult = { data: unknown; error: unknown };

function chainable(result: QueryResult) {
  const chain: Record<string, (...args: unknown[]) => unknown> = {};
  chain.select = () => chain;
  chain.eq = () => chain;
  chain.order = () => chain;
  chain.limit = () => chain;
  chain.single = async () => result;
  chain.then = (resolve: (value: unknown) => unknown) =>
    Promise.resolve(result).then(resolve);
  return chain;
}

const lower = '11111111-1111-4111-8111-111111111111';

function variantProduct(manageStock: boolean, rows: unknown[]) {
  return {
    from: (table: string) =>
      chainable(
        table === 'products'
          ? {
              data: {
                name: 'Phone',
                slug: 'phone',
                price: 100,
                manage_stock: manageStock,
                has_variants: true,
                has_condition_offers: false,
              },
              error: null,
            }
          : { data: null, error: null }
      ),
    rpc: async () => ({ data: rows, error: null }),
  } as unknown as SupabaseClient;
}

function stockedRows(count: number) {
  return Array.from({ length: count }, () => ({
    product_id: lower,
    stock_quantity: 5,
  }));
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

it('fails a managed line closed on the 129th-row truncation sentinel', async () => {
  const result = await check(variantProduct(true, stockedRows(129)));
  // Every row is stocked, yet the PDP refuses truncated products as
  // unavailable: selection would dead-end, so report unavailable.
  expect(result.structuredContent).toMatchObject({
    success: false,
    product_unavailable: true,
  });
});

it('selects options for a managed line at exactly the 128-row window', async () => {
  const result = await check(variantProduct(true, stockedRows(128)));
  expect(result.structuredContent).toMatchObject({
    success: false,
    requires_variant_selection: true,
    product_id: lower,
  });
});

it('fails an unmanaged line closed on the 129th-row truncation sentinel', async () => {
  const result = await check(variantProduct(false, stockedRows(129)));
  expect(result.structuredContent).toMatchObject({
    success: false,
    product_unavailable: true,
  });
});

it('selects options for an unmanaged line at exactly the 128-row window', async () => {
  const result = await check(variantProduct(false, stockedRows(128)));
  expect(result.structuredContent).toMatchObject({
    success: false,
    requires_variant_selection: true,
    product_id: lower,
  });
});
