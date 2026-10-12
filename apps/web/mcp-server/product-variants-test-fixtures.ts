import { vi } from 'vitest';

type MockRpcResponse = {
  data: Record<string, unknown>[] | null;
  error: { message: string } | null;
};

type ProductLookup = {
  id: string;
  name: string | null;
  manage_stock: boolean;
  has_variants: boolean;
  has_condition_offers: boolean;
  color: string | null;
  color_images: Record<string, unknown> | null;
};

export function createSupabase() {
  const query = {
    select: vi.fn(),
    eq: vi.fn(),
    limit: vi.fn(),
    single: vi.fn(
      async (): Promise<{
        data: ProductLookup | null;
        error: { code?: string; message: string } | null;
      }> => ({
        data: {
          id: 'phone-1',
          name: 'Phone',
          manage_stock: true,
          has_variants: true,
          has_condition_offers: false,
          color: null,
          color_images: null,
        },
        error: null,
      }),
    ),
  };
  query.select.mockReturnValue(query);
  query.eq.mockReturnValue(query);
  query.limit.mockReturnValue(query);
  return {
    from: vi.fn(() => query),
    query,
    rpc: vi.fn(
      async (name: string): Promise<MockRpcResponse> =>
        name === 'get_storefront_product_variants'
          ? {
              data: [
                {
                  attributes: { color: 'Red' },
                  price_override: null,
                  stock_quantity: 2,
                },
              ],
              error: null,
            }
          : { data: [], error: null },
    ),
  };
}
