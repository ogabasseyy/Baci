import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createMockSupabase,
  harness,
  resetFeedDataHarness,
} from './feed-data.test-helpers';

const mockCreateAnonClient = vi.fn();

vi.mock('@/lib/supabase/anon', () => ({
  createAnonClient: () => mockCreateAnonClient(),
}));

vi.mock('next/cache', () => ({
  cacheLife: vi.fn(),
  cacheTag: vi.fn(),
}));

beforeEach(() => {
  resetFeedDataHarness();
  mockCreateAnonClient.mockReturnValue(createMockSupabase());
});

describe('getCachedOpenAIFeedData offer hydration', () => {
  it('attaches offers for products flagged with condition offers', async () => {
    harness.productsResult = {
      data: [
        {
          id: 'prod-1',
          name: 'Test Phone',
          created_at: '2026-01-01T00:00:00.000Z',
          description: 'A phone',
          slug: 'test-phone',
          price: 50000,
          stock: 5,
          stock_quantity: 5,
          manage_stock: true,
          has_condition_offers: true,
          variants: [],
        },
      ],
      error: null,
    };
    harness.offersResult = {
      data: [
        {
          id: 'offer-1',
          product_id: 'prod-1',
          condition: 'used',
          price: 40000,
          images: ['https://cdn.example.com/offer-used.jpg'],
        },
      ],
      error: null,
    };
    const { getCachedOpenAIFeedData } = await import('./feed-data');
    const result = await getCachedOpenAIFeedData('merchant-1');

    expect(result.products).toHaveLength(1);
    expect(result.products[0].offers).toEqual([
      { images: ['https://cdn.example.com/offer-used.jpg'] },
    ]);
  });

  it('drops non-emittable offers from image claims', async () => {
    harness.productsResult = {
      data: [
        {
          id: 'prod-1',
          name: 'Test Phone',
          created_at: '2026-01-01T00:00:00.000Z',
          description: 'A phone',
          slug: 'test-phone',
          price: 50000,
          stock: 5,
          stock_quantity: 5,
          manage_stock: true,
          condition: 'new',
          has_condition_offers: true,
          variants: [],
        },
      ],
      error: null,
    };
    harness.offersResult = {
      data: [
        {
          id: 'offer-zero',
          product_id: 'prod-1',
          condition: 'used',
          price: 0,
          images: ['https://cdn.example.com/offer-zero.jpg'],
        },
        {
          id: 'offer-same',
          product_id: 'prod-1',
          condition: 'new',
          price: 40000,
          images: ['https://cdn.example.com/offer-same.jpg'],
        },
        {
          id: 'offer-good',
          product_id: 'prod-1',
          condition: 'used',
          price: 40000,
          images: ['https://cdn.example.com/offer-good.jpg'],
        },
      ],
      error: null,
    };
    const { getCachedOpenAIFeedData } = await import('./feed-data');
    const result = await getCachedOpenAIFeedData('merchant-1');

    // Zero-price and same-condition offers render no rows, so they
    // must not claim imagery either.
    expect(result.products[0].offers).toEqual([
      { images: ['https://cdn.example.com/offer-good.jpg'] },
    ]);
  });
});
