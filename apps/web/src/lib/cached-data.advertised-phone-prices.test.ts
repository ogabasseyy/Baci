import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getCachedCategoryPageData,
  getCachedStorefrontHomeProducts,
} from './cached-data';
import {
  buildCachedDataTestHarness,
  type CachedDataTestHarness,
} from './cached-data.test-utils';

vi.mock('@/env', () => ({
  getSupabaseUrl: () => 'https://test.supabase.co',
  getSupabaseAnonKey: () => 'test-anon',
}));
vi.mock('next/cache', () => ({ cacheLife: vi.fn(), cacheTag: vi.fn() }));
vi.mock('react', () => ({ cache: (fn: unknown) => fn }));
vi.mock('@/lib/public-serialized-variant-summary', () => ({
  getPublicSerializedVariantSummariesByProductId: vi.fn(async () => []),
}));
vi.mock('@supabase/supabase-js', async () => {
  const { getMockCreateClient } = await import('./cached-data.test-utils');
  return {
    createClient: (...args: unknown[]) => getMockCreateClient()?.(...args),
  };
});

const phone = {
  id: 'phone',
  name: 'iPhone 16',
  price: 600000,
  category: 'Smartphones',
  has_variants: true,
  variant_model: 'sku_matrix' as const,
  manage_stock: false,
  stock: 0,
};
const variants = [
  {
    id: 'wifi',
    product_id: 'phone',
    attributes: { sim_type: 'Wi-Fi Only' },
    price_override: 600000,
    condition: 'used',
    stock_quantity: 0,
  },
  {
    id: 'cellular',
    product_id: 'phone',
    attributes: { sim_type: 'Physical + eSIM' },
    price_override: 900000,
    condition: 'new',
    stock_quantity: 0,
  },
];
let harness: CachedDataTestHarness;
beforeEach(() => {
  harness = buildCachedDataTestHarness();
  harness.mockRpc.mockResolvedValue({ data: variants, error: null });
});

function seedCategory() {
  harness.mockSingle.mockResolvedValueOnce({
    data: {
      id: 'cat',
      name: 'Smartphones',
      slug: 'active-category',
      is_active: true,
      parent: null,
    },
    error: null,
  });
  harness.mockListResults.push(
    { data: [{ id: 'cat' }], error: null },
    { data: [{ id: 'phone' }], error: null },
    { data: [], count: 1, error: null },
    { data: [phone], error: null }
  );
}

describe('cached listing phone-price projection', () => {
  it('hydrates the already selected home window with one public variant batch and scalar display facts', async () => {
    harness.mockListResult.data = [phone];
    const rows = await getCachedStorefrontHomeProducts('merchant');
    expect(rows[0]).toMatchObject({
      price: 600000,
      advertised_price: 900000,
      advertised_condition: 'new',
    });
    expect(rows[0]).not.toHaveProperty('variants');
    expect(harness.mockRpc).toHaveBeenCalledExactlyOnceWith(
      'get_storefront_product_variants',
      { p_product_ids: ['phone'] }
    );
    expect(harness.mockSelect).toHaveBeenCalledWith(
      expect.stringContaining('has_variants')
    );
  });

  it('projects the selected category window while retaining the original catalog count', async () => {
    seedCategory();
    const result = await getCachedCategoryPageData(
      'merchant',
      'active-category',
      'shop',
      0,
      40
    );
    expect(result.products).toEqual([
      expect.objectContaining({ price: 600000, advertised_price: 900000 }),
    ]);
    expect(result.productCount).toBe(1);
  });

  it('removes a restricted-only family from the visible window without inventing an eligible global total', async () => {
    seedCategory();
    harness.mockRpc.mockResolvedValue({ data: [variants[0]], error: null });
    const result = await getCachedCategoryPageData(
      'merchant',
      'active-category',
      'shop',
      0,
      40
    );
    expect(result.products).toEqual([]);
    expect(result.productCount).toBe(1);
    expect(result.productsQueryFailed).toBe(false);
  });

  it('does not serve a false home price after variant RPC failure', async () => {
    harness.mockListResult.data = [phone];
    harness.mockRpc.mockResolvedValue({
      data: null,
      error: new Error('public RPC unavailable'),
    });
    await expect(getCachedStorefrontHomeProducts('merchant')).rejects.toThrow(
      'public RPC unavailable'
    );
  });
});
