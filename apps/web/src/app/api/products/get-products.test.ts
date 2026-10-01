import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getProductListContext: vi.fn(),
  range: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock('./get-product-list-context', () => ({
  getProductListContext: mocks.getProductListContext,
}));

import { getProducts } from './get-products';

describe('getProducts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.range.mockResolvedValue({
      data: [
        {
          id: 'product-1',
          name: 'Phone',
          description: null,
          price: '499.99',
          stock_quantity: 4,
          manage_stock: true,
          images: [{ url: 'https://cdn.example/phone.jpg' }],
          variants: [
            {
              attributes: { color: 'Black', storage: '128GB', size: 'M' },
              is_inventory_anchor: true,
            },
            { attributes: { color: 'Black', storage: '256GB', size: 'L' } },
          ],
          category: 'Electronics',
          sku: 'PHONE-1',
          slug: 'phone',
        },
      ],
      error: null,
      count: 1,
    });
    mocks.rpc.mockResolvedValue({
      data: { inventoryValue: 1999.96, outOfStockCount: 0, categoryCount: 1 },
      error: null,
    });
    const query = {
      select: vi.fn(() => query),
      eq: vi.fn(() => query),
      order: vi.fn(() => query),
      range: mocks.range,
    };
    mocks.getProductListContext.mockResolvedValue({
      merchantId: 'merchant-1',
      query: {
        page: 1,
        limit: 20,
        search: undefined,
        migration: 'All',
        status: 'All',
        stock: 'All',
        ids: undefined,
      },
      supabase: {
        from: vi.fn(() => query),
        rpc: mocks.rpc,
      },
    });
  });

  it('returns list-ready variant filters alongside the product', async () => {
    const response = await getProducts(
      new NextRequest('http://localhost:3000/api/products')
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.products[0]).toMatchObject({
      id: 'product-1',
      colors: ['Black'],
      storage_options: ['128GB', '256GB'],
      available_sizes: ['M', 'L'],
    });
    expect(body.pagination).toMatchObject({ page: 1, limit: 20, total: 1 });
    expect(body.products[0].variants[0].is_inventory_anchor).toBe(true);
  });

  it('returns the authorization response without querying products', async () => {
    mocks.getProductListContext.mockResolvedValue({
      response: new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
      }),
    });

    const response = await getProducts(
      new NextRequest('http://localhost:3000/api/products')
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'Unauthorized' });
  });

  it('includes products whose variant SKU matches the search', async () => {
    const productQuery = {
      select: vi.fn(() => productQuery),
      eq: vi.fn(() => productQuery),
      order: vi.fn(() => productQuery),
      ilike: vi.fn(() => productQuery),
      or: vi.fn(() => productQuery),
      range: mocks.range,
    };
    mocks.getProductListContext.mockResolvedValue({
      merchantId: 'merchant-1',
      query: {
        page: 1,
        limit: 20,
        search: 'PHONE-BLACK',
        migration: 'All',
        status: 'All',
        stock: 'All',
        ids: undefined,
      },
      supabase: {
        from: vi.fn(() => productQuery),
        rpc: mocks.rpc,
      },
    });
    mocks.range.mockResolvedValue({
      data: [
        {
          id: '00000000-0000-4000-8000-000000000001',
          name: 'Phone',
          description: null,
          price: '499.99',
          stock_quantity: 4,
          manage_stock: true,
          images: [],
          variants: [{ id: 'variant-1', sku: 'PHONE-BLACK' }],
          category: 'Electronics',
          sku: null,
        },
      ],
      error: null,
      count: 1,
    });

    const response = await getProducts(
      new NextRequest('http://localhost:3000/api/products?search=PHONE-BLACK')
    );

    expect(response.status).toBe(200);
    expect(productQuery.select).toHaveBeenCalledWith(
      expect.stringContaining(
        'variant_search:product_variants!product_variants_product_id_fkey()'
      ),
      { count: 'exact' }
    );
    expect(productQuery.ilike).toHaveBeenCalledWith(
      'variant_search.sku',
      '%PHONE-BLACK%'
    );
    expect(productQuery.or).toHaveBeenCalledWith(
      'name.ilike.%PHONE-BLACK%,sku.ilike.%PHONE-BLACK%,variant_search.not.is.null'
    );
  });
});
