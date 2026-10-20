import { jest } from '@jest/globals';
import { getStorefrontProductBaseInventoryByProductIds } from '@/lib/fetch-storefront-product-base-inventory';

const mockWithSupabaseRetry = jest.fn();
const mockRpc = jest.fn();

jest.mock('@/lib/api', () => ({
  withSupabaseRetry: (operation: () => Promise<unknown>, options?: unknown) =>
    mockWithSupabaseRetry(operation, options),
}));

jest.mock('@/lib/logger', () => ({
  createLogger: () => ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  }),
}));

jest.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: (...args: unknown[]) => mockRpc(...args),
  },
}));

describe('fetch-storefront-product-base-inventory', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockWithSupabaseRetry.mockImplementation((...args: unknown[]) => {
      const operation = args[0] as () => Promise<unknown>;
      return operation();
    });
  });

  it('returns an empty object without calling the rpc when no base ids are provided', async () => {
    await expect(
      getStorefrontProductBaseInventoryByProductIds([])
    ).resolves.toEqual({});
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('maps base inventory rows by product id in one rpc call', async () => {
    mockRpc.mockReturnValueOnce(
      Promise.resolve({
        data: [
          {
            product_id: 'product-1',
            effective_policy: 'serialized_strict',
            available_units: 4,
          },
        ],
        error: null,
      })
    );

    await expect(
      getStorefrontProductBaseInventoryByProductIds(['product-1', 'product-1'])
    ).resolves.toEqual({
      'product-1': {
        product_id: 'product-1',
        effective_policy: 'serialized_strict',
        available_units: 4,
      },
    });
    expect(mockRpc).toHaveBeenCalledTimes(1);
    expect(mockRpc).toHaveBeenCalledWith(
      'get_storefront_product_base_inventory',
      { p_product_ids: ['product-1'] }
    );
  });

  it('returns null when the base inventory lookup fails', async () => {
    mockRpc.mockReturnValueOnce(
      Promise.resolve({ data: null, error: { message: 'boom' } })
    );

    await expect(
      getStorefrontProductBaseInventoryByProductIds(['product-1'])
    ).resolves.toBeNull();
  });

  it('chunks requests at the 500-id RPC cap and merges rows', async () => {
    const ids = Array.from({ length: 501 }, (_, i) => `product-${i}`);
    mockRpc.mockImplementation(async (_name: unknown, args: unknown) => {
      const chunk = (args as { p_product_ids: string[] }).p_product_ids;
      expect(chunk.length).toBeLessThanOrEqual(500);
      return {
        data: chunk.map((id: string) => ({
          product_id: id,
          effective_policy: 'managed',
          available_units: null,
        })),
        error: null,
      };
    });

    const result = await getStorefrontProductBaseInventoryByProductIds(ids);

    expect(mockRpc).toHaveBeenCalledTimes(2);
    expect(Object.keys(result ?? {})).toHaveLength(501);
    expect(result?.['product-500']?.product_id).toBe('product-500');
  });

  it('returns null when any chunk fails', async () => {
    const ids = Array.from({ length: 501 }, (_, i) => `product-${i}`);
    mockRpc
      .mockReturnValueOnce(Promise.resolve({ data: [], error: null }))
      .mockReturnValueOnce(
        Promise.resolve({ data: null, error: { message: 'boom' } })
      );

    await expect(
      getStorefrontProductBaseInventoryByProductIds(ids)
    ).resolves.toBeNull();
  });
});
