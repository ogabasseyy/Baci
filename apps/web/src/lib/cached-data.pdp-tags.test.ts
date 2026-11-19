import { cacheTag } from 'next/cache';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getCachedProductLcpHint } from '@/lib/cached-data';
import {
  buildCachedDataTestHarness,
  type CachedDataTestHarness,
  resetMockCreateClient,
} from '@/lib/cached-data.test-utils';
import { getProductScopedCacheTag } from '@/lib/product-cache-tags';

vi.mock('@/env', () => ({
  getSupabaseUrl: vi.fn(() => 'https://test.supabase.co'),
  getSupabaseAnonKey: vi.fn(() => 'test-anon-key'),
  getSupabaseServiceRoleKey: vi.fn(() => 'test-service-role-key'),
}));
vi.mock('next/cache', () => ({ cacheLife: vi.fn(), cacheTag: vi.fn() }));
vi.mock('react', () => ({ cache: vi.fn((fn) => fn) }));
vi.mock('@/lib/public-serialized-variant-summary', async () => {
  const actual = await vi.importActual<
    typeof import('@/lib/public-serialized-variant-summary')
  >('@/lib/public-serialized-variant-summary');
  return {
    ...actual,
    getPublicSerializedVariantSummariesByProductId: vi.fn(() =>
      Promise.resolve([])
    ),
  };
});
vi.mock('@supabase/supabase-js', async () => {
  const { getMockCreateClient } = await import('@/lib/cached-data.test-utils');
  return {
    createClient: (...args: unknown[]) => {
      const createClient = getMockCreateClient();
      if (!createClient) {
        return {
          from: () => ({
            select: () => ({
              eq: () => ({
                maybeSingle: vi.fn(),
                single: vi.fn(),
                eq: vi.fn(),
              }),
            }),
          }),
          auth: { getUser: vi.fn() },
        };
      }
      return createClient(...args);
    },
  };
});

describe('cached-data PDP scoped cache tags', () => {
  let harness: CachedDataTestHarness;

  beforeEach(() => {
    harness = buildCachedDataTestHarness();
  });

  afterEach(() => {
    resetMockCreateClient();
    vi.restoreAllMocks();
  });

  it('getCachedProductLcpHint reads route, image, and variant data from one bounded snapshot', async () => {
    harness.mockRpc.mockResolvedValueOnce({
      data: [
        {
          resolution_status: 'found',
          product_data: {
            id: 'product-123',
            slug: 'iphone-16',
            brand: 'Apple',
            categories: {
              id: 'category-123',
              name: 'Smartphones',
              slug: 'smartphones',
            },
            images: ['https://example.com/iphone.jpg'],
            merchant_id: 'merchant-123',
            name: 'iPhone 16',
            price: 910000,
            product_key_specs: null,
            product_offers: [],
            product_variants: [
              {
                attributes: { storage: '128GB' },
                id: 'variant-1',
                product_id: 'product-123',
                stock_quantity: 2,
              },
            ],
            variant_attributes: { storage: ['128GB'] },
          },
        },
      ],
      error: null,
      status: 200,
    });

    const result = await getCachedProductLcpHint('merchant-123', 'iphone-16');

    expect(harness.mockRpc).toHaveBeenCalledWith(
      'get_storefront_pdp_core_v2',
      { p_merchant_id: 'merchant-123', p_product_slug: 'iphone-16' },
      { get: true }
    );
    expect(harness.mockRpc).toHaveBeenCalledOnce();
    expect(harness.mockSelect).not.toHaveBeenCalled();
    expect(cacheTag).toHaveBeenCalledWith(
      'product',
      'product-lcp-hint',
      'product-details-merchant-123',
      getProductScopedCacheTag('product', 'merchant-123', 'iphone-16')
    );
    expect(cacheTag).toHaveBeenCalledWith(
      'product',
      'product-details',
      'product-details-merchant-123',
      'product-lcp-hint',
      'categories-merchant-123',
      getProductScopedCacheTag('product', 'merchant-123', 'iphone-16')
    );
    expect(result?.product_variants).toEqual([
      expect.objectContaining({
        attributes: { storage: '128GB' },
        id: 'variant-1',
      }),
    ]);
    expect(result?.variant_attributes).toEqual({ storage: ['128GB'] });
  });
});
