import { jest } from '@jest/globals';
import { hydrateProductRowsWithBaseInventory } from '@/lib/storefront-product-base-inventory';

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

describe('storefront-product-base-inventory', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockWithSupabaseRetry.mockImplementation((...args: unknown[]) => {
      const operation = args[0] as () => Promise<unknown>;
      return operation();
    });
  });

  it('attaches base inventory to matching rows and leaves the rest untouched', async () => {
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

    const rows = [{ id: 'product-1' }, { id: 'product-2' }];
    await expect(hydrateProductRowsWithBaseInventory(rows)).resolves.toEqual([
      {
        id: 'product-1',
        base_effective_policy: 'serialized_strict',
        base_available_units: 4,
      },
      { id: 'product-2' },
    ]);
  });

  it('keeps the original rows when the base inventory lookup fails', async () => {
    mockRpc.mockReturnValueOnce(
      Promise.resolve({ data: null, error: { message: 'boom' } })
    );

    const rows = [{ id: 'product-1', base_available_units: 9 }];
    await expect(hydrateProductRowsWithBaseInventory(rows)).resolves.toEqual(
      rows
    );
  });
});
