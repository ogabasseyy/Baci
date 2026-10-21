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

  // Well-formed authority ids (the shared client rejects malformed
  // ids before any RPC, exactly like the server would).
  const uuid = (n: number) =>
    `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  const PRODUCT_1 = uuid(1);
  const PRODUCT_2 = uuid(2);
  const OFFER_7 = uuid(7);

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
            product_id: PRODUCT_1,
            offer_id: OFFER_7,
            condition: 'used',
            price_basis: 80000,
            compare_at_price: 90000,
            allocatable_stock: 2,
            parent_eligible: true,
            grade: 'B',
            condition_notes: 'Light wear',
            images: ['offer.jpg'],
          },
          { product_id: PRODUCT_1, offer_id: null },
        ],
        error: null,
      })
    );

    await expect(
      getStorefrontProductOffersByProductIds([PRODUCT_1, PRODUCT_2, PRODUCT_1])
    ).resolves.toEqual({
      [PRODUCT_1]: [
        {
          compare_at_price: 90000,
          condition: 'used',
          condition_notes: 'Light wear',
          grade: 'B',
          id: OFFER_7,
          images: ['offer.jpg'],
          price: 80000,
          stock_quantity: 2,
        },
      ],
      [PRODUCT_2]: [],
    });
    expect(mockRpc).toHaveBeenCalledTimes(1);
    expect(mockRpc).toHaveBeenCalledWith('get_storefront_offer_resolution', {
      p_merchant_id: null,
      p_product_ids: [PRODUCT_1, PRODUCT_2],
    });
  });

  it('keeps every requested id even for large product lists', async () => {
    mockRpc.mockImplementation(() =>
      Promise.resolve({ data: [], error: null })
    );

    const ids = Array.from({ length: 25 }, (_, index) => uuid(100 + index));
    const result = await getStorefrontProductOffersByProductIds(ids);

    expect(Object.keys(result ?? {})).toHaveLength(25);
    expect(mockRpc).toHaveBeenCalledTimes(1);
    expect(mockRpc).toHaveBeenCalledWith('get_storefront_offer_resolution', {
      p_merchant_id: null,
      p_product_ids: ids,
    });
  });

  it('chunks past the 200-id unscoped cap and merges every chunk', async () => {
    const chunkSizes: number[] = [];
    mockRpc.mockImplementation((...call: unknown[]) => {
      const ids = (call[1] as { p_product_ids: string[] }).p_product_ids;
      chunkSizes.push(ids.length);
      return Promise.resolve({
        data: ids.map((id) => ({
          product_id: id,
          offer_id: OFFER_7,
          condition: 'used',
          price_basis: 80000,
          allocatable_stock: 2,
          parent_eligible: true,
        })),
        error: null,
      });
    });

    const ids = Array.from({ length: 250 }, (_, index) => uuid(1000 + index));
    const result = await getStorefrontProductOffersByProductIds(ids);

    expect(mockRpc).toHaveBeenCalledTimes(2);
    expect(chunkSizes).toEqual([200, 50]);
    expect(Object.keys(result ?? {})).toHaveLength(250);
    expect(result?.[ids[0]]).toHaveLength(1);
    expect(result?.[ids[249]]).toHaveLength(1);
  });

  it('omits a gated row a partial projection still carries', async () => {
    mockRpc.mockReturnValueOnce(
      Promise.resolve({
        data: [
          {
            product_id: PRODUCT_1,
            offer_id: OFFER_7,
            condition: 'used',
            price_basis: 80000,
            allocatable_stock: 2,
            parent_eligible: false,
          },
        ],
        error: null,
      })
    );

    await expect(
      getStorefrontProductOffersByProductIds([PRODUCT_1])
    ).resolves.toEqual({ [PRODUCT_1]: [] });
    expect(mockRpc).toHaveBeenCalledTimes(1);
  });

  it('matches an uppercase caller id to a lowercase live row under the caller key', async () => {
    mockRpc.mockReturnValueOnce(
      Promise.resolve({
        data: [
          {
            product_id: PRODUCT_1,
            offer_id: OFFER_7,
            condition: 'used',
            price_basis: 80000,
            allocatable_stock: 2,
            parent_eligible: true,
          },
        ],
        error: null,
      })
    );

    await expect(
      getStorefrontProductOffersByProductIds([PRODUCT_1.toUpperCase()])
    ).resolves.toEqual({
      [PRODUCT_1.toUpperCase()]: [
        {
          compare_at_price: null,
          condition: 'used',
          condition_notes: null,
          grade: null,
          id: OFFER_7,
          images: undefined,
          price: 80000,
          stock_quantity: 2,
        },
      ],
    });
  });

  it('returns null when the offer lookup fails', async () => {
    mockRpc.mockReturnValueOnce(
      Promise.resolve({ data: null, error: { message: 'boom' } })
    );

    await expect(
      getStorefrontProductOffersByProductIds([PRODUCT_1, PRODUCT_2])
    ).resolves.toBeNull();
    expect(mockRpc).toHaveBeenCalledTimes(1);
  });
});
