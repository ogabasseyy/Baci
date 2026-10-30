import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';
import {
  mockFrom,
  mockOperations,
  mockRpc,
  resetSandboxQueryMocks,
  setSandboxFixtureRows,
} from './sandbox-product-pages.test-utils';

jest.mock('@/lib/api', () => ({
  withSupabaseRetry: (operation: () => Promise<unknown>) => operation(),
}));
jest.mock('@/lib/logger', () => ({
  createLogger: () => ({ warn: jest.fn() }),
}));
jest.mock('@/lib/supabase', () => ({
  supabase: {
    from: (...args: unknown[]) => mockFrom(...args),
    rpc: (...args: unknown[]) => mockRpc(...args),
  },
}));
jest.mock('./product-transform', () => ({
  transformProduct: (row: unknown) => row,
}));

import { fetchProductsPage } from './product-pages';

describe('pinned sandbox product refinements', () => {
  const originalEnvironment = { ...process.env };

  beforeEach(() => {
    resetSandboxQueryMocks();
    process.env.EXPO_PUBLIC_HOSTED_STOREFRONT = '1';
    process.env.EXPO_PUBLIC_API_URL = 'https://staging.ogabassey.com';
    process.env.EXPO_PUBLIC_SUPABASE_URL = 'https://staging-auth.ogabassey.com';
  });

  afterEach(() => {
    for (const name of [
      'EXPO_PUBLIC_HOSTED_STOREFRONT',
      'EXPO_PUBLIC_API_URL',
      'EXPO_PUBLIC_SUPABASE_URL',
    ]) {
      const value = originalEnvironment[name];
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });

  it('applies PostgREST filters, scans every candidate page, then processor-filters, sorts, and paginates', async () => {
    setSandboxFixtureRows(
      Array.from({ length: 1003 }, (_, index) => ({
        id: `product-${index}`,
        merchant_id: '10000000-0000-4000-8000-000000000001',
        name: `Laptop ${index}`,
        brand: index === 1000 ? 'Dell' : index % 2 === 0 ? 'Apple' : 'Samsung',
        price: 1003 - index,
        status: 'active',
        has_variants: false,
        has_condition_offers: false,
        manage_stock: false,
        inventory_tracking_policy: 'legacy',
        specifications:
          index === 996
            ? [{ items: [{ label: 'CPU', value: '13th Gen Intel Core i7' }] }]
            : {
                Processor:
                  index === 998
                    ? 'Intel Core i7 and AMD Ryzen 7'
                    : index % 2 === 0
                      ? 'Intel Core i7-1360P'
                      : 'Intel Core i5-1240P',
              },
      }))
    );

    const result = await fetchProductsPage(
      '10000000-0000-4000-8000-000000000001',
      {
        limit: 1,
        search: 'laptop',
        refinements: {
          brands: ['Apple', 'Samsung'],
          processor: ' INTEL CORE I7 ',
          sort: 'price_asc',
        },
      },
      1
    );

    expect(mockOperations).toContainEqual({
      method: 'in',
      args: ['brand', ['Apple', 'Samsung']],
    });
    expect(mockOperations).toContainEqual({
      method: 'ilike',
      args: ['name', '%laptop%'],
    });
    expect(
      mockOperations.filter(({ method }) => method === 'limit')
    ).toHaveLength(3);
    expect(mockOperations.filter(({ method }) => method === 'gt')).toHaveLength(
      2
    );
    expect(mockOperations).toContainEqual({
      method: 'order',
      args: ['id', { ascending: true }],
    });
    expect(mockOperations).toContainEqual({
      method: 'select',
      args: [expect.any(String), { count: 'exact', head: true }],
    });
    expect(result).toEqual({
      products: [expect.objectContaining({ id: 'product-996' })],
      total: 500,
      nextOffset: 2,
    });
    const rpcNames = mockRpc.mock.calls.map(([name]) => name);
    expect(rpcNames).not.toContain(
      'search_storefront_products_processor_refined'
    );
    expect(rpcNames).not.toContain('search_products_v2');
  });

  it('fails closed when the exact processor candidate count exceeds the scan bound', async () => {
    setSandboxFixtureRows(
      Array.from({ length: 10_001 }, (_, index) => ({
        id: `product-${index}`,
        merchant_id: '10000000-0000-4000-8000-000000000001',
        name: `Laptop ${index}`,
        brand: 'Apple',
        status: 'active',
        has_variants: false,
        has_condition_offers: false,
        manage_stock: false,
        inventory_tracking_policy: 'legacy',
        specifications: { Processor: 'Intel Core i7' },
      }))
    );

    await expect(
      fetchProductsPage(
        '10000000-0000-4000-8000-000000000001',
        {
          search: 'laptop',
          refinements: {
            brands: ['Apple'],
            processor: 'Intel Core i7',
            sort: 'price_asc',
          },
        },
        0
      )
    ).rejects.toThrow('Sandbox search refinements unavailable');

    expect(
      mockOperations.filter(({ method }) => method === 'limit')
    ).toHaveLength(0);
    const rpcNames = mockRpc.mock.calls.map(([name]) => name);
    expect(rpcNames).not.toContain(
      'search_storefront_products_processor_refined'
    );
  });

  it('fails closed for matching products whose variant availability the fallback cannot represent', async () => {
    const unsupportedProducts = [
      {
        id: 'variant-laptop',
        merchant_id: '10000000-0000-4000-8000-000000000001',
        name: 'Laptop with variants',
        brand: 'Apple',
        price: 100,
        status: 'active',
        has_variants: true,
        has_condition_offers: false,
        manage_stock: false,
        inventory_tracking_policy: 'legacy',
        specifications: { Processor: 'Intel Core i7' },
      },
      {
        id: 'offer-laptop',
        merchant_id: '10000000-0000-4000-8000-000000000001',
        name: 'Laptop with condition offers',
        brand: 'Apple',
        status: 'active',
        has_variants: false,
        has_condition_offers: true,
        manage_stock: false,
        inventory_tracking_policy: 'legacy',
        specifications: { Processor: 'Intel Core i7' },
      },
      {
        id: 'serialized-laptop',
        merchant_id: '10000000-0000-4000-8000-000000000001',
        name: 'Strict serialized laptop',
        brand: 'Apple',
        status: 'active',
        has_variants: false,
        has_condition_offers: false,
        manage_stock: true,
        inventory_tracking_policy: 'serialized_strict',
        specifications: { Processor: 'Intel Core i7' },
      },
      {
        id: 'sku-matrix-laptop',
        merchant_id: '10000000-0000-4000-8000-000000000001',
        name: 'SKU matrix laptop with stale has_variants flag',
        brand: 'Apple',
        price: 100,
        status: 'active',
        has_variants: false,
        variant_model: 'sku_matrix',
        has_condition_offers: false,
        manage_stock: false,
        inventory_tracking_policy: 'legacy',
        specifications: { Processor: 'Intel Core i7' },
      },
    ];

    for (const product of unsupportedProducts) {
      setSandboxFixtureRows([product]);
      await expect(
        fetchProductsPage(
          '10000000-0000-4000-8000-000000000001',
          {
            search: 'laptop',
            refinements: {
              brands: ['Apple'],
              minPrice: 10,
              maxPrice: 20,
              processor: 'Intel Core i7',
              sort: 'price_asc',
            },
          },
          0
        )
      ).rejects.toThrow('Sandbox search refinements unavailable');
    }
  });

  it('treats null manage_stock as stock-managed when checking availability', async () => {
    setSandboxFixtureRows([
      {
        id: 'null-stock-management',
        merchant_id: '10000000-0000-4000-8000-000000000001',
        name: 'Laptop with unknown stock management',
        brand: 'Apple',
        price: 100,
        status: 'active',
        has_variants: false,
        variant_model: 'legacy',
        has_condition_offers: false,
        manage_stock: null,
        stock_quantity: 0,
        stock: 0,
        inventory_tracking_policy: 'legacy',
        specifications: { Processor: 'Intel Core i7' },
      },
    ]);

    const result = await fetchProductsPage(
      '10000000-0000-4000-8000-000000000001',
      {
        search: 'laptop',
        refinements: {
          brands: ['Apple'],
          processor: 'Intel Core i7',
          sort: 'price_asc',
        },
      },
      0
    );

    expect(result).toEqual({ products: [], total: 0, nextOffset: null });
  });
});
