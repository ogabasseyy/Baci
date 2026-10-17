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
});
