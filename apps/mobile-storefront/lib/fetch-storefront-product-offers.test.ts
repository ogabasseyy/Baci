import { jest } from '@jest/globals';
import { getStorefrontProductOffersByProductIds } from '@/lib/fetch-storefront-product-offers';

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

describe('fetch-storefront-product-offers', () => {
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

  it('maps authority rows by product id in one batched call', async () => {
    mockRpc.mockReturnValueOnce(
      Promise.resolve({
        data: [
          {
            product_id: 'product-1',
            offer_id: 'offer-7',
            condition: 'used',
            price_basis: 80000,
            compare_at_price: 90000,
            allocatable_stock: 2,
            parent_eligible: true,
            grade: 'B',
            condition_notes: 'Light wear',
            images: ['offer.jpg'],
          },
          { product_id: 'product-1', offer_id: null },
        ],
        error: null,
      })
    );

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
    expect(mockRpc).toHaveBeenCalledTimes(1);
    expect(mockRpc).toHaveBeenCalledWith('get_storefront_offer_resolution', {
      p_merchant_id: null,
      p_product_ids: ['product-1', 'product-2'],
    });
  });

  it('keeps every requested id even for large product lists', async () => {
    mockRpc.mockImplementation(() =>
      Promise.resolve({ data: [], error: null })
    );

    const ids = Array.from({ length: 25 }, (_, index) => `product-${index}`);
    const result = await getStorefrontProductOffersByProductIds(ids);

    expect(Object.keys(result ?? {})).toHaveLength(25);
    expect(mockRpc).toHaveBeenCalledTimes(1);
    expect(mockRpc).toHaveBeenCalledWith('get_storefront_offer_resolution', {
      p_merchant_id: null,
      p_product_ids: ids,
    });
  });

  it('returns null when the offer lookup fails', async () => {
    mockRpc.mockReturnValueOnce(
      Promise.resolve({ data: null, error: { message: 'boom' } })
    );

    await expect(
      getStorefrontProductOffersByProductIds(['product-1', 'product-2'])
    ).resolves.toBeNull();
  });
});
