import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import type { FeedProduct } from './feed-builder';
import { fetchActiveFeedOffers } from './fetch-active-feed-offers';
import { attachConditionOffers } from './hydrate-feed-condition-offers';

vi.mock('./fetch-active-feed-offers', () => ({
  fetchActiveFeedOffers: vi.fn(),
}));

const mockFetchActiveFeedOffers = vi.mocked(fetchActiveFeedOffers);

function product(overrides: Partial<FeedProduct> = {}): FeedProduct {
  return {
    id: 'p1',
    name: 'Phone',
    description: 'Phone',
    price: 100,
    stock: 1,
    variant_model: 'legacy',
    ...overrides,
  };
}

describe('attachConditionOffers', () => {
  it('maps offer rows onto legacy products with condition offers', async () => {
    mockFetchActiveFeedOffers.mockResolvedValue([
      {
        id: 'used',
        product_id: 'p1',
        condition: 'used',
        price: '80',
        compare_at_price: null,
        stock_quantity: 1,
        images: ['https://cdn.example/used.jpg'],
      },
    ]);
    const products = [product({ has_condition_offers: true })];

    await attachConditionOffers({} as SupabaseClient, products);

    expect(mockFetchActiveFeedOffers).toHaveBeenCalledWith({}, ['p1']);
    expect(products[0].offers).toEqual([
      {
        images: ['https://cdn.example/used.jpg'],
        id: 'used',
        condition: 'used',
        compare_at_price: null,
        price: 80,
        stock_quantity: 1,
      },
    ]);
  });

  it('skips the fetch when no legacy product uses condition offers', async () => {
    mockFetchActiveFeedOffers.mockClear();
    const products = [
      product({ variant_model: 'sku_matrix', has_condition_offers: true }),
      product({ id: 'p2', has_condition_offers: false }),
    ];

    await attachConditionOffers({} as SupabaseClient, products);

    expect(mockFetchActiveFeedOffers).not.toHaveBeenCalled();
    expect(products[0].offers).toBeUndefined();
    expect(products[1].offers).toBeUndefined();
  });

  it('leaves products without returned rows untouched', async () => {
    mockFetchActiveFeedOffers.mockResolvedValue([]);
    const products = [product({ has_condition_offers: true })];

    await attachConditionOffers({} as SupabaseClient, products);

    expect(products[0].offers).toBeUndefined();
  });
});
