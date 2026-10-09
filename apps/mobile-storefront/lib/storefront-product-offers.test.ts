import { jest } from '@jest/globals';
import { hydrateProductRowsWithConditionOffers } from '@/lib/storefront-product-offers';

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

describe('storefront-product-offers', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockWithSupabaseRetry.mockImplementation((...args: unknown[]) => {
      const operation = args[0] as () => Promise<unknown>;
      return operation();
    });
  });

  it('attaches offers to matching rows and leaves the rest untouched', async () => {
    mockRpc
      .mockReturnValueOnce(
        Promise.resolve({
          data: [{ offer_id: 'offer-7', condition: 'used', price: 80000 }],
          error: null,
        })
      )
      .mockReturnValueOnce(Promise.resolve({ data: [], error: null }));

    const rows = [{ id: 'product-1' }, { id: 'product-2' }];
    await expect(hydrateProductRowsWithConditionOffers(rows)).resolves.toEqual([
      {
        id: 'product-1',
        offers: [
          {
            compare_at_price: null,
            condition: 'used',
            condition_notes: null,
            grade: null,
            id: 'offer-7',
            images: undefined,
            price: 80000,
            stock_quantity: null,
          },
        ],
      },
      { id: 'product-2', offers: [] },
    ]);
  });

  it('keeps the original rows when the offer lookup fails', async () => {
    mockRpc.mockReturnValueOnce(
      Promise.resolve({ data: null, error: { message: 'boom' } })
    );

    const rows = [{ id: 'product-1', offers: [{ id: 'nested' }] }];
    await expect(hydrateProductRowsWithConditionOffers(rows)).resolves.toEqual(
      rows
    );
  });
});
