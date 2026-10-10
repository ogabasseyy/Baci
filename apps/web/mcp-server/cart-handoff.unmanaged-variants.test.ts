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

function unmanagedVariantProduct(
  variants: Record<string, unknown>[],
  manageStock: boolean | null = false,
  hasOffers = false
): SupabaseClient {
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
                has_condition_offers: hasOffers,
              },
              error: null,
            }
          : { data: null, error: null }
      ),
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

it('reports unavailable for strict-only variants with no units', async () => {
  const result = await check(
    unmanagedVariantProduct([
      { stock_quantity: 0, effective_policy: 'serialized_strict' },
    ])
  );
  expect(result.structuredContent).toMatchObject({
    success: false,
    product_unavailable: true,
  });
});

it('reports unavailable when no variant rows resolve', async () => {
  // An empty successful projection: the storefront cart provider cannot
  // add a variant product without a resolvable variant ID, so selection
  // would dead-end on the PDP.
  const result = await check(unmanagedVariantProduct([]));
  expect(result.structuredContent).toEqual({
    success: false,
    product_unavailable: true,
  });
});

it('selects options when a strict variant has units', async () => {
  const result = await check(
    unmanagedVariantProduct([
      { stock_quantity: 2, effective_policy: 'serialized_strict' },
    ])
  );
  expect(result.structuredContent).toMatchObject({
    success: false,
    requires_variant_selection: true,
    product_id: lower,
  });
});

it('fails open for ordinary variants at zero stock', async () => {
  const result = await check(
    unmanagedVariantProduct([{ stock_quantity: 0 }])
  );
  expect(result.structuredContent).toMatchObject({
    success: false,
    requires_variant_selection: true,
    product_id: lower,
  });
});

it('fails open when strict and ordinary variants mix', async () => {
  const result = await check(
    unmanagedVariantProduct([
      { stock_quantity: 0, effective_policy: 'serialized_strict' },
      { stock_quantity: 0 },
    ])
  );
  expect(result.structuredContent).toMatchObject({
    success: false,
    requires_variant_selection: true,
    product_id: lower,
  });
});

it('reports unavailable for a null parent with zero-stock ordinary variants', async () => {
  // Legacy null parents are managed inventory (isPublicVariantPurchasable):
  // no purchasable option means unavailable, not a dead-end PDP.
  const result = await check(
    unmanagedVariantProduct([{ stock_quantity: 0 }], null)
  );
  expect(result.structuredContent).toMatchObject({
    success: false,
    product_unavailable: true,
  });
});

it('selects options for a null parent with a stocked ordinary variant', async () => {
  const result = await check(
    unmanagedVariantProduct([{ stock_quantity: 2 }], null)
  );
  expect(result.structuredContent).toMatchObject({
    success: false,
    requires_variant_selection: true,
    product_id: lower,
  });
});

it('selects options for a null parent with a then-unlimited variant', async () => {
  const result = await check(
    unmanagedVariantProduct(
      [{ stock_quantity: 0, effective_policy: 'serialized_then_unlimited' }],
      null
    )
  );
  expect(result.structuredContent).toMatchObject({
    success: false,
    requires_variant_selection: true,
    product_id: lower,
  });
});

it('reports unavailable for combined offers when every variant is depleted', async () => {
  // An offer cannot substitute for the paired variant that owns
  // inventory, so combined-option products validate variants too —
  // selection would otherwise dead-end on the PDP.
  const result = await check(
    unmanagedVariantProduct(
      [{ stock_quantity: 0, effective_policy: 'serialized_strict' }],
      false,
      true
    )
  );
  expect(result.structuredContent).toMatchObject({
    success: false,
    product_unavailable: true,
  });
});

it('selects options for combined offers when a variant passes', async () => {
  const result = await check(
    unmanagedVariantProduct(
      [{ stock_quantity: 2, effective_policy: 'serialized_strict' }],
      false,
      true
    )
  );
  expect(result.structuredContent).toMatchObject({
    success: false,
    requires_variant_selection: true,
    product_id: lower,
  });
});
