jest.mock('@/lib/config', () => ({
  CONFIG: {
    MERCHANT_ID: '77777777-7777-4777-8777-777777777777',
    MERCHANT_SLUG: 'ogabassey',
  },
}));

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

describe('offer response-safe batching', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockWithSupabaseRetry.mockImplementation((...args: unknown[]) => {
      const operation = args[0] as () => Promise<unknown>;
      return operation();
    });
  });
  const uuid = (n: number) =>
    `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  const OFFER_7 = uuid(7);

  it('chunks merchant-scoped batches and merges every chunk', async () => {
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

    const ids = Array.from({ length: 1250 }, (_, index) => uuid(1000 + index));
    const result = await getStorefrontProductOffersByProductIds(ids);

    expect(mockRpc).toHaveBeenCalledTimes(7);
    expect(chunkSizes).toEqual([200, 200, 200, 200, 200, 200, 50]);
    expect(Object.keys(result ?? {})).toHaveLength(1250);
    expect(result?.[ids[0]]).toHaveLength(1);
    expect(result?.[ids[1249]]).toHaveLength(1);
  });

  it('keeps all offers when the server caps each response at 1000 rows', async () => {
    mockRpc.mockImplementation((...call: unknown[]) => {
      const ids = (call[1] as { p_product_ids: string[] }).p_product_ids;
      const rows = ids.flatMap((id) =>
        [7, 8].map((n) => ({
          product_id: id,
          offer_id: uuid(n),
          condition: n === 7 ? 'used' : 'new',
          price_basis: 80000,
          allocatable_stock: 2,
          parent_eligible: true,
        }))
      );
      return Promise.resolve({ data: rows.slice(0, 1000), error: null });
    });
    const ids = Array.from({ length: 600 }, (_, index) => uuid(2000 + index));
    const result = await getStorefrontProductOffersByProductIds(ids);
    expect(ids.every((id) => result?.[id]?.length === 2)).toBe(true);
  });
});
