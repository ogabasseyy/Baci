import type { SupabaseClient } from '@supabase/supabase-js';
import { expect, it, vi } from 'vitest';
import { prepareCartHandoff } from './cart-handoff';

type QueryResult = { data: unknown; error: unknown };

function chainable(result: QueryResult) {
  const chain: Record<string, (...args: unknown[]) => unknown> = {};
  chain.select = () => chain;
  chain.eq = () => chain;
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

const call = (supabase: SupabaseClient) =>
  prepareCartHandoff({
    supabase,
    merchantId: 'merchant',
    productId: 'product',
    quantity: 1,
    formatPrice: String,
  });

it('marks a missing product unavailable for replay triage', async () => {
  const result = await call(
    supabaseFor({
      products: {
        data: null,
        error: { code: 'PGRST116', message: 'No rows' },
      },
    })
  );
  expect(result.structuredContent).toEqual({
    success: false,
    product_unavailable: true,
  });
});

it('leaves transient query failures untyped so callers fail closed', async () => {
  const result = await call(
    supabaseFor({
      products: { data: null, error: { code: 'XX000', message: 'boom' } },
    })
  );
  expect(result.structuredContent).toEqual({ success: false });
});

it('marks an out-of-stock line unavailable', async () => {
  const result = await call(
    supabaseFor({
      products: {
        data: {
          name: 'Phone',
          manage_stock: true,
          has_variants: false,
          has_condition_offers: false,
          stock_quantity: 0,
        },
        error: null,
      },
    })
  );
  expect(result.structuredContent).toEqual({
    success: false,
    product_unavailable: true,
  });
});

it('matches an uppercase variant UUID against canonical lowercase rows', async () => {
  const lower = '11111111-1111-4111-8111-111111111111';
  const supabase = supabaseFor({
    products: {
      data: {
        name: 'Phone',
        slug: 'phone',
        manage_stock: true,
        has_variants: true,
        has_condition_offers: false,
      },
      error: null,
    },
  }) as unknown as {
    rpc: () => Promise<{ data: unknown; error: unknown }>;
  } & SupabaseClient;
  supabase.rpc = async () => ({
    data: [{ product_id: lower, stock_quantity: 5 }],
    error: null,
  });
  const result = await prepareCartHandoff({
    supabase,
    merchantId: 'merchant',
    productId: lower.toUpperCase(),
    quantity: 1,
    formatPrice: String,
  });
  expect(result.structuredContent).toMatchObject({
    success: false,
    requires_variant_selection: true,
    product_id: lower,
  });
});

it('gates a strict serialized line on anchor units despite stored stock', async () => {
  const lower = '11111111-1111-4111-8111-111111111111';
  const result = await prepareCartHandoff({
    supabase: supabaseFor(
      {
        products: {
          data: {
            name: 'Phone',
            price: 100,
            manage_stock: false,
            has_variants: false,
            has_condition_offers: false,
            stock_quantity: 99,
          },
          error: null,
        },
      },
      {
        data: [
          {
            product_id: lower,
            effective_policy: 'serialized_strict',
            available_units: 0,
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
  expect(result.structuredContent).toEqual({
    success: false,
    product_unavailable: true,
  });
});

it('accepts a then-unlimited line with zero raw stock', async () => {
  const lower = '11111111-1111-4111-8111-111111111111';
  const result = await prepareCartHandoff({
    supabase: supabaseFor(
      {
        products: {
          data: {
            name: 'Phone',
            price: 100,
            manage_stock: true,
            has_variants: false,
            has_condition_offers: false,
            stock_quantity: 0,
          },
          error: null,
        },
      },
      {
        data: [
          {
            product_id: lower,
            effective_policy: 'serialized_then_unlimited',
            available_units: 0,
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
  expect(result.structuredContent).toMatchObject({
    success: true,
    product_id: lower,
  });
});

it('fails open on stored stock when the anchor lookup errors', async () => {
  const error = vi.spyOn(console, 'error').mockImplementation(() => {});
  try {
    const result = await prepareCartHandoff({
      supabase: supabaseFor(
        {
          products: {
            data: {
              name: 'Phone',
              price: 100,
              manage_stock: true,
              has_variants: false,
              has_condition_offers: false,
              stock_quantity: 0,
            },
            error: null,
          },
        },
        { data: null, error: { code: 'XX000', message: 'boom' } }
      ),
      merchantId: 'merchant',
      productId: '11111111-1111-4111-8111-111111111111',
      quantity: 1,
      formatPrice: String,
    });
    // Stored stock rejects, but the outage keeps the failure untyped so
    // callers retry instead of treating the line as permanently dead.
    expect(result.structuredContent).toEqual({ success: false });
    expect(error).toHaveBeenCalled();
  } finally {
    error.mockRestore();
  }
});
