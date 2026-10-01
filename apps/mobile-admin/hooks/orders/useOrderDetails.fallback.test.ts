import { describe, expect, it, vi } from 'vitest';

type QueryResult = { data: unknown; error: null };

vi.mock('@/lib/supabase', () => {
  const order = {
    id: 'order-1',
    recorded_by_user_id: null,
    total: 100,
    wallet_amount_used: 0,
  };
  const item = {
    condition: null,
    id: 'item-legacy',
    image_url: null,
    item_description: null,
    name: null,
    price: 25,
    product_id: 'product-1',
    products: {
      category: 'Accessories',
      condition: 'used',
      images: ['https://example.test/product.jpg'],
      name: 'Legacy Charger',
    },
    quantity: 1,
    variant_id: null,
  };

  function makeChain(table: string) {
    const result = () =>
      table === 'orders'
        ? { data: order, error: null }
        : table === 'order_items'
          ? { data: [item], error: null }
          : { data: [], error: null };
    const chain = {} as Record<string, (...args: unknown[]) => unknown> & {
      maybeSingle: () => Promise<QueryResult>;
      single: () => Promise<QueryResult>;
      then: (resolve: (value: QueryResult) => unknown) => Promise<unknown>;
    };

    for (const method of ['select', 'eq', 'in', 'order']) {
      chain[method] = () => chain;
    }

    chain.single = () => Promise.resolve(result());
    chain.maybeSingle = () => Promise.resolve({ data: null, error: null });
    // biome-ignore lint/suspicious/noThenProperty: Mocking a Supabase query builder
    chain.then = (resolve) => Promise.resolve(result()).then(resolve);
    return chain;
  }

  return {
    supabase: {
      from: vi.fn((table: string) => makeChain(table)),
    },
  };
});

vi.mock('@tanstack/react-query', () => ({
  useQuery: vi.fn(),
}));

vi.mock('../useBranchScope', () => ({
  useBranchScope: () => ({ scope: { type: 'all' } }),
}));

vi.mock('../useMerchant', () => ({
  useMerchant: () => ({ merchant: { id: 'merchant-1' } }),
}));

import { fetchOrderById } from './useOrderDetails';

describe('fetchOrderById legacy item fallbacks', () => {
  it('keeps product fallbacks separate from persisted legacy snapshots', async () => {
    await expect(fetchOrderById('order-1', 'merchant-1')).resolves.toEqual(
      expect.objectContaining({
        items: [
          expect.objectContaining({
            category: 'Accessories',
            condition: undefined,
            details: undefined,
            display_condition: 'used',
            display_image_url: 'https://example.test/product.jpg',
            image_url: undefined,
            name: 'Legacy Charger',
            product_name: 'Legacy Charger',
            variant_id: null,
          }),
        ],
      })
    );
  });
});
