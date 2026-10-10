import type { SupabaseClient } from '@supabase/supabase-js';
import { expect, it } from 'vitest';
import { prepareCartHandoff } from './cart-handoff';

const lower = '11111111-1111-4111-8111-111111111111';

type Row = Record<string, unknown>;

function clientFor(variants: Row[], offers: Row[]): SupabaseClient {
  const chain: Record<string, (...args: unknown[]) => unknown> = {};
  chain.select = () => chain;
  chain.eq = () => chain;
  chain.order = () => chain;
  chain.limit = () => chain;
  chain.single = async () => ({
    data: {
      name: 'Phone',
      slug: 'phone',
      price: 100,
      manage_stock: true,
      stock_quantity: 0,
      stock: 0,
      has_variants: true,
      has_condition_offers: true,
      condition: 'new',
    },
    error: null,
  });
  chain.then = (resolve: (value: unknown) => unknown) =>
    Promise.resolve({ data: offers, error: null }).then(resolve);
  return {
    from: () => chain,
    rpc: async () => ({
      data: variants.map((variant) => ({ ...variant, product_id: lower })),
      error: null,
    }),
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

function offer(stock: number, condition = 'used') {
  return {
    product_id: lower,
    merchant_id: 'merchant',
    status: 'active',
    condition,
    id: 'offer-01',
    stock_quantity: stock,
  };
}

it('refuses a stocked offer when every variant is depleted', async () => {
  // PDP parity (resolvePublicProductOption): a paired variant owns
  // purchasability, so the stocked offer cannot rescue depleted
  // variants — selection would dead-end on the PDP.
  const result = await check(
    clientFor([{ stock_quantity: 0 }], [offer(5)])
  );
  expect(result.structuredContent).toEqual({
    success: false,
    product_unavailable: true,
  });
});

it('selects options when a variant passes alongside a stocked offer', async () => {
  const result = await check(
    clientFor(
      [{ stock_quantity: 0 }, { stock_quantity: 5 }],
      [offer(5)]
    )
  );
  expect(result.structuredContent).toMatchObject({
    success: false,
    requires_variant_selection: true,
    product_id: lower,
  });
});

it('refuses depleted variants without offers', async () => {
  const result = await check(clientFor([{ stock_quantity: 0 }], []));
  expect(result.structuredContent).toEqual({
    success: false,
    product_unavailable: true,
  });
});
