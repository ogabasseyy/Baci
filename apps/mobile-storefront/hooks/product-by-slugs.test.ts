import { beforeEach, describe, expect, it, jest } from '@jest/globals';

const mockQueryResult: { data: unknown; error: unknown } = {
  data: [],
  error: null,
};
const mockIn = jest.fn((_column: string, _values: unknown) =>
  Promise.resolve(mockQueryResult)
);
const mockEqStatus = jest.fn((_column: string, _value: unknown) => ({
  in: mockIn,
}));
const mockEqMerchant = jest.fn((_column: string, _value: unknown) => ({
  eq: mockEqStatus,
}));
const mockSelect = jest.fn((_columns: string) => ({ eq: mockEqMerchant }));
const mockFrom = jest.fn((_table: string) => ({ select: mockSelect }));
const mockHydrate = jest.fn((rows: unknown) => Promise.resolve(rows));

jest.mock('@/lib/supabase', () => ({
  supabase: { from: (table: string) => mockFrom(table) },
}));
jest.mock('@/lib/api', () => ({
  withSupabaseRetry: (fn: () => unknown) => fn(),
}));
jest.mock('@/hooks/product-hydration', () => ({
  hydrateRowsNeedingStorefrontVariants: (rows: unknown) => mockHydrate(rows),
  hydrateRowsNeedingBaseInventory: (rows: unknown) => mockHydrate(rows),
}));
jest.mock('./product-transform', () => ({
  transformProduct: (row: unknown) => row,
}));
jest.mock('@/lib/logger', () => ({
  createLogger: () => ({
    warn: jest.fn(),
    info: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  }),
}));

import { fetchProductsBySlugs } from './product-by-slugs';
import { PRODUCT_SELECT } from './product-select';

describe('fetchProductsBySlugs', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockQueryResult.data = [];
    mockQueryResult.error = null;
  });

  it('builds a merchant-scoped, active, slug-filtered query with PRODUCT_SELECT', async () => {
    mockQueryResult.data = [{ id: 'p1', slug: 'a27' }];

    await fetchProductsBySlugs('merchant-1', ['a27', 'power80']);

    expect(mockFrom).toHaveBeenCalledWith('products');
    expect(mockSelect).toHaveBeenCalledWith(PRODUCT_SELECT);
    expect(String(mockSelect.mock.calls[0]?.[0])).not.toContain('*');
    expect(mockEqMerchant).toHaveBeenCalledWith('merchant_id', 'merchant-1');
    expect(mockEqStatus).toHaveBeenCalledWith('status', 'active');
    expect(mockIn).toHaveBeenCalledWith('slug', ['a27', 'power80']);
  });

  it('hydrates rows (incl. has_variants rows) before transforming', async () => {
    const rows = [{ id: 'p1', slug: 'a27', has_variants: true, variants: [] }];
    mockQueryResult.data = rows;

    const result = await fetchProductsBySlugs('merchant-1', ['a27']);

    expect(mockHydrate).toHaveBeenCalledWith(rows);
    expect(result).toEqual(rows);
  });

  it('throws when the query returns an error', async () => {
    mockQueryResult.data = null;
    mockQueryResult.error = { message: 'boom' };

    await expect(fetchProductsBySlugs('merchant-1', ['a27'])).rejects.toEqual(
      expect.objectContaining({ message: 'boom' })
    );
  });

  it('short-circuits to [] for an empty slug list without querying', async () => {
    await expect(fetchProductsBySlugs('merchant-1', [])).resolves.toEqual([]);
    expect(mockFrom).not.toHaveBeenCalled();
  });
});
