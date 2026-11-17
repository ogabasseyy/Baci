import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockIn,
  mockEqStatus,
  mockEqMerchant,
  mockSelect,
  mockProjectStandardListingRows,
  mockMapProduct,
} = vi.hoisted(() => ({
  mockIn: vi.fn(),
  mockEqStatus: vi.fn(),
  mockEqMerchant: vi.fn(),
  mockSelect: vi.fn(),
  mockProjectStandardListingRows: vi.fn(),
  mockMapProduct: vi.fn((row: unknown) => row),
}));

vi.mock('next/cache', () => ({
  cacheLife: vi.fn(),
  cacheTag: vi.fn(),
}));
vi.mock('@/lib/supabase/anon', () => ({
  createAnonClient: () => ({
    from: () => ({ select: mockSelect }),
  }),
}));
vi.mock('@/lib/project-standard-listing-rows', () => ({
  projectStandardListingRows: (...args: unknown[]) =>
    mockProjectStandardListingRows(...args),
}));
vi.mock('./storefront-products-route-data', () => ({
  storefrontProductsRouteData: {
    STOREFRONT_PRODUCTS_SELECT: 'id,name,full',
    STOREFRONT_PRODUCTS_COMPACT_SELECT: 'id,name',
    mapProduct: (row: unknown) => mockMapProduct(row),
  },
}));

import { fetchProductsByIds } from './storefront-products-by-ids';

describe('fetchProductsByIds', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSelect.mockReturnValue({ eq: mockEqMerchant });
    mockEqMerchant.mockReturnValue({ eq: mockEqStatus });
    mockEqStatus.mockReturnValue({ in: mockIn });
    mockProjectStandardListingRows.mockImplementation(
      async (_merchantId: string, rows: unknown[]) => rows
    );
  });

  it('returns empty array without querying when ids is empty', async () => {
    await expect(fetchProductsByIds('merchant-1', [])).resolves.toEqual([]);
    expect(mockSelect).not.toHaveBeenCalled();
  });

  it('chunks large ID lists and projects mapped products', async () => {
    const ids = Array.from({ length: 105 }, (_, i) => `id-${i}`);
    mockIn
      .mockResolvedValueOnce({ data: [{ id: 'id-0' }], error: null })
      .mockResolvedValueOnce({ data: [{ id: 'id-100' }], error: null });

    const result = await fetchProductsByIds('merchant-1', ids, {
      compact: false,
    });

    expect(mockSelect).toHaveBeenCalledWith('id,name,full');
    expect(mockIn).toHaveBeenCalledTimes(2);
    expect(result).toEqual([{ id: 'id-0' }, { id: 'id-100' }]);
  });

  it('throws when Supabase returns an error', async () => {
    mockIn.mockResolvedValueOnce({
      data: null,
      error: new Error('db failure'),
    });

    await expect(fetchProductsByIds('merchant-1', ['id-1'])).rejects.toThrow(
      'db failure'
    );
  });
});
