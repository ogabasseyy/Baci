import { jest } from '@jest/globals';
import {
  getStorefrontProductOffersByProductIds,
  hydrateProductRowsWithConditionOffers,
} from '@/lib/storefront-product-offers';

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

  it('returns an empty object without calling the rpc when no offer product ids are provided', async () => {
    await expect(getStorefrontProductOffersByProductIds([])).resolves.toEqual(
      {}
    );
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('maps active offer rows by product id with one rpc per id', async () => {
    mockRpc
      .mockReturnValueOnce(
        Promise.resolve({
          data: [
            {
              offer_id: 'offer-7',
              condition: 'used',
              price: 80000,
              compare_at_price: 90000,
              stock_quantity: 2,
              grade: 'B',
              condition_notes: 'Light wear',
              images: ['offer.jpg'],
            },
            { offer_id: null, condition: 'used', price: 1 },
          ],
          error: null,
        })
      )
      .mockReturnValueOnce(Promise.resolve({ data: [], error: null }));

    await expect(
      getStorefrontProductOffersByProductIds([
        'product-1',
        'product-2',
        'product-1',
      ])
    ).resolves.toEqual({
      'product-1': [
        {
          compare_at_price: 90000,
          condition: 'used',
          condition_notes: 'Light wear',
          grade: 'B',
          id: 'offer-7',
          images: ['offer.jpg'],
          price: 80000,
          stock_quantity: 2,
        },
      ],
      'product-2': [],
    });
    expect(mockRpc).toHaveBeenCalledTimes(2);
    expect(mockRpc).toHaveBeenCalledWith('get_product_offers', {
      p_product_id: 'product-1',
    });
    expect(mockRpc).toHaveBeenCalledWith('get_product_offers', {
      p_product_id: 'product-2',
    });
  });

  it('returns null when any offer lookup fails', async () => {
    mockRpc
      .mockReturnValueOnce(Promise.resolve({ data: [], error: null }))
      .mockReturnValueOnce(
        Promise.resolve({ data: null, error: { message: 'boom' } })
      );

    await expect(
      getStorefrontProductOffersByProductIds(['product-1', 'product-2'])
    ).resolves.toBeNull();
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
