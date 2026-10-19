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

function supabaseFor(
  tables: Record<string, QueryResult>,
  rpcResult: QueryResult = { data: [], error: null }
) {
  return {
    from: (table: string) =>
      chainable(tables[table] ?? { data: null, error: null }),
    rpc: async () => rpcResult,
  } as unknown as SupabaseClient;
}
it('selects options when a nullable ordinary variant inherits stocked parent inventory', async () => {
  const lower = '11111111-1111-4111-8111-111111111111';
  const result = await prepareCartHandoff({
    supabase: supabaseFor(
      {
        products: {
          data: {
            name: 'Phone',
            slug: 'phone',
            price: 100,
            manage_stock: true,
            stock_quantity: 5,
            has_variants: true,
            has_condition_offers: false,
          },
          error: null,
        },
      },
      {
        data: [{ product_id: lower, stock_quantity: null }],
        error: null,
      }
    ),
    merchantId: 'merchant',
    productId: lower,
    quantity: 1,
    formatPrice: String,
  });
  // Canonical parity with isPublicVariantPurchasable: a null ordinary
  // quantity inherits the parent stock, so the PDP sells this option
  // and the tool must offer selection instead of refusing it.
  expect(result.structuredContent).toMatchObject({
    success: false,
    requires_variant_selection: true,
    product_id: lower,
  });
});

it('refuses a nullable ordinary variant when the parent is depleted', async () => {
  const lower = '11111111-1111-4111-8111-111111111111';
  const result = await prepareCartHandoff({
    supabase: supabaseFor(
      {
        products: {
          data: {
            name: 'Phone',
            slug: 'phone',
            price: 100,
            manage_stock: true,
            stock_quantity: 0,
            has_variants: true,
            has_condition_offers: false,
          },
          error: null,
        },
      },
      {
        data: [{ product_id: lower, stock_quantity: null }],
        error: null,
      }
    ),
    merchantId: 'merchant',
    productId: lower,
    quantity: 1,
    formatPrice: String,
  });
  expect(result.structuredContent).toEqual({
    success: false,
    product_unavailable: true,
  });
});

it('gates a nullable strict variant on exact units despite a stocked parent', async () => {
  const lower = '11111111-1111-4111-8111-111111111111';
  const result = await prepareCartHandoff({
    supabase: supabaseFor(
      {
        products: {
          data: {
            name: 'Phone',
            slug: 'phone',
            price: 100,
            manage_stock: true,
            stock_quantity: 5,
            has_variants: true,
            has_condition_offers: false,
          },
          error: null,
        },
      },
      {
        data: [
          {
            product_id: lower,
            stock_quantity: null,
            effective_policy: 'serialized_strict',
          },
        ],
        error: null,
      }
    ),
    merchantId: 'merchant',
    productId: lower,
    quantity: 1,
    formatPrice: String,
  });
  // Serialized rows stay exact: hydrated units decide, never the parent.
  expect(result.structuredContent).toEqual({
    success: false,
    product_unavailable: true,
  });
});
