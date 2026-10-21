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

const PRODUCT_1 = '11111111-1111-4111-8111-111111111111';
const PRODUCT_2 = '22222222-2222-4222-8222-222222222222';
const OFFER_7 = '77777777-7777-4777-8777-777777777777';

describe('storefront-product-offers', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockWithSupabaseRetry.mockImplementation((...args: unknown[]) => {
      const operation = args[0] as () => Promise<unknown>;
      return operation();
    });
  });

  it('attaches offers to matching rows and leaves the rest untouched', async () => {
    mockRpc.mockReturnValueOnce(
      Promise.resolve({
        data: [
          {
            product_id: PRODUCT_1,
            offer_id: OFFER_7,
            condition: 'used',
            price_basis: 80000,
            allocatable_stock: null,
            parent_eligible: true,
          },
        ],
        error: null,
      })
    );

    const rows = [{ id: PRODUCT_1 }, { id: PRODUCT_2 }];
    await expect(hydrateProductRowsWithConditionOffers(rows)).resolves.toEqual([
      {
        id: PRODUCT_1,
        offers: [
          {
            compare_at_price: null,
            condition: 'used',
            condition_notes: null,
            grade: null,
            id: OFFER_7,
            images: undefined,
            price: 80000,
            stock_quantity: null,
          },
        ],
      },
      { id: PRODUCT_2, offers: [] },
    ]);
  });

  it('marks the original rows when the offer lookup fails', async () => {
    mockRpc.mockReturnValueOnce(
      Promise.resolve({ data: null, error: { message: 'boom' } })
    );

    const rows = [{ id: PRODUCT_1, offers: [{ id: 'nested' }] }];
    await expect(hydrateProductRowsWithConditionOffers(rows)).resolves.toEqual([
      {
        id: PRODUCT_1,
        offers: [{ id: 'nested' }],
        offers_hydration_failed: true,
      },
    ]);
  });
});
