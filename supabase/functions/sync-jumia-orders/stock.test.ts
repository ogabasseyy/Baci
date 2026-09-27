import { describe, expect, it, vi } from 'vitest';
import { syncJumiaStockForIntegration } from './stock';

function createSupabase(result: { data: unknown[] | null; error: unknown }) {
  let eqCalls = 0;
  const query = {
    select: vi.fn(() => query),
    eq: vi.fn(() => {
      eqCalls += 1;
      return eqCalls === 4 ? Promise.resolve(result) : query;
    }),
  };
  return { from: vi.fn(() => query), query };
}

describe('syncJumiaStockForIntegration', () => {
  it('does nothing when an integration has no mappings', async () => {
    const { query, ...supabase } = createSupabase({ data: [], error: null });

    const result = await syncJumiaStockForIntegration({
      supabase: supabase as never,
      integration: {
        merchant_id: 'merchant-1',
        shop_id: 'shop-1',
        marketplace_key: 'oauth',
      } as never,
      accessToken: 'access-token',
      config: { apiBase: 'https://vendor-api.example' },
      refreshToken: vi.fn(),
    });

    expect(result).toEqual({ updated: 0, skipped: 0 });
    expect(query.eq).toHaveBeenCalledWith('marketplace_key', 'oauth');
  });

  it('fails closed on a mapping lookup error without calling Jumia', async () => {
    const { query, ...supabase } = createSupabase({
      data: null,
      error: { message: 'temporary database failure' },
    });
    const fetchMock = vi.spyOn(globalThis, 'fetch');

    const result = await syncJumiaStockForIntegration({
      supabase: supabase as never,
      integration: {
        merchant_id: 'merchant-1',
        shop_id: 'shop-1',
        marketplace_key: 'oauth',
      } as never,
      accessToken: 'access-token',
      config: { apiBase: 'https://vendor-api.example' },
      refreshToken: vi.fn(),
    });

    expect(result).toEqual({ updated: 0, skipped: 0 });
    expect(query.eq).toHaveBeenCalledWith('marketplace_key', 'oauth');
    expect(fetchMock).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });

  it('skips an OAuth shop with multiple active business clients', async () => {
    let eqCalls = 0;
    const mappingsQuery = {
      select: vi.fn(() => mappingsQuery),
      eq: vi.fn(() => {
        eqCalls += 1;
        return eqCalls === 4
          ? Promise.resolve({
              data: [
                {
                  id: 'mapping-1',
                  product_id: 'product-1',
                  variant_id: null,
                  jumia_seller_sku: 'SKU-1',
                  jumia_product_id: 'pid-1',
                  baci_stock_at_last_sync: 2,
                },
              ],
              error: null,
            })
          : mappingsQuery;
      }),
    };
    const supabase = { from: vi.fn(() => mappingsQuery) };
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          shops: [
            {
              id: 'shop-1',
              businessClients: [
                { code: 'NG-1', status: 'active' },
                { code: 'NG-2', status: 'Active' },
              ],
            },
          ],
        }),
        { status: 200 }
      )
    );

    const result = await syncJumiaStockForIntegration({
      supabase: supabase as never,
      integration: {
        merchant_id: 'merchant-1',
        shop_id: 'shop-1',
        marketplace_key: 'oauth',
      } as never,
      accessToken: 'access-token',
      config: { apiBase: 'https://vendor-api.example' },
      refreshToken: vi.fn(),
    });

    expect(result).toEqual({ updated: 0, skipped: 0 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      'https://vendor-api.example/shops'
    );
    fetchMock.mockRestore();
  });

  it('fails closed when the shop marketplaces cannot be verified', async () => {
    let eqCalls = 0;
    const mappingsQuery = {
      select: vi.fn(() => mappingsQuery),
      eq: vi.fn(() => {
        eqCalls += 1;
        return eqCalls === 4
          ? Promise.resolve({
              data: [
                {
                  id: 'mapping-1',
                  product_id: 'product-1',
                  variant_id: null,
                  jumia_seller_sku: 'SKU-1',
                  jumia_product_id: 'pid-1',
                  baci_stock_at_last_sync: 2,
                },
              ],
              error: null,
            })
          : mappingsQuery;
      }),
    };
    const supabase = { from: vi.fn(() => mappingsQuery) };
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('gateway timeout', { status: 504 }));

    const result = await syncJumiaStockForIntegration({
      supabase: supabase as never,
      integration: {
        merchant_id: 'merchant-1',
        shop_id: 'shop-1',
        marketplace_key: 'oauth',
      } as never,
      accessToken: 'access-token',
      config: { apiBase: 'https://vendor-api.example' },
      refreshToken: vi.fn(),
    });

    expect(result).toEqual({ updated: 0, skipped: 0 });
    expect(
      fetchMock.mock.calls.some(
        (call) =>
          typeof call[0] === 'string' &&
          call[0].includes('/feeds/products/stock')
      )
    ).toBe(false);
    fetchMock.mockRestore();
  });

  it('pushes stock when the shop has a single active marketplace', async () => {
    let eqCalls = 0;
    const mappingsQuery = {
      select: vi.fn(() => mappingsQuery),
      eq: vi.fn(() => {
        eqCalls += 1;
        return eqCalls === 4
          ? Promise.resolve({
              data: [
                {
                  id: 'mapping-1',
                  product_id: 'product-1',
                  variant_id: null,
                  jumia_seller_sku: 'SKU-1',
                  jumia_product_id: 'pid-1',
                  baci_stock_at_last_sync: 2,
                },
              ],
              error: null,
            })
          : mappingsQuery;
      }),
      update: vi.fn(() => ({
        eq: vi.fn().mockResolvedValue({ error: null }),
      })),
    };
    const supabase = {
      from: vi.fn((table: string) => {
        if (table === 'products') {
          return {
            select: vi.fn(() => ({
              in: vi.fn().mockResolvedValue({
                data: [{ id: 'product-1', stock: 5, stock_quantity: 5 }],
                error: null,
              }),
            })),
          };
        }
        return mappingsQuery;
      }),
    };
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation((input) =>
        Promise.resolve(
          typeof input === 'string' && input.endsWith('/shops')
            ? new Response(
                JSON.stringify({
                  shops: [
                    {
                      id: 'shop-1',
                      businessClients: [{ code: 'NG-1', status: 'active' }],
                    },
                  ],
                }),
                { status: 200 }
              )
            : new Response(JSON.stringify({ feedId: 'feed-1' }), {
                status: 200,
              })
        )
      );

    const result = await syncJumiaStockForIntegration({
      supabase: supabase as never,
      integration: {
        merchant_id: 'merchant-1',
        shop_id: 'shop-1',
        marketplace_key: 'oauth',
      } as never,
      accessToken: 'access-token',
      config: { apiBase: 'https://vendor-api.example' },
      refreshToken: vi.fn(),
    });

    expect(result).toEqual({ updated: 1, skipped: 0 });
    expect(
      fetchMock.mock.calls.some(
        (call) =>
          typeof call[0] === 'string' &&
          call[0].includes('/feeds/products/stock')
      )
    ).toBe(true);
    fetchMock.mockRestore();
  });
});
