import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getCachedProductSemanticInventory,
  PRODUCT_SEMANTIC_INVENTORY_BASE_SELECT,
} from './get-cached-product-semantic-inventory';

const mockGetPublicSupabaseClient = vi.fn();

vi.mock('@/lib/cached-data', () => ({
  getPublicSupabaseClient: () => mockGetPublicSupabaseClient(),
}));

function createProductsQuery(result: {
  data?: unknown[] | null;
  error?: unknown;
}) {
  const query = {
    eq: vi.fn(() => query),
    limit: vi.fn(() => query),
    order: vi.fn(() => query),
    select: vi.fn(() => query),
    abortSignal: vi.fn(() => query),
    retry: vi.fn(() => query),
    // biome-ignore lint/suspicious/noThenProperty: mock intentionally mimics postgrest-js's thenable query builder
    then: (
      resolve: (value: typeof result) => unknown,
      reject?: (reason: unknown) => unknown
    ) => Promise.resolve(result).then(resolve, reject),
  };
  return query;
}

describe('getCachedProductSemanticInventory stock resolution', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('includes manage_stock in PRODUCT_SEMANTIC_INVENTORY_BASE_SELECT', () => {
    expect(PRODUCT_SEMANTIC_INVENTORY_BASE_SELECT).toContain('manage_stock');
  });

  describe('manage_stock candidate stock resolution', () => {
    it.each([
      {
        label: 'unmanaged with false',
        row: {
          slug: 'unmanaged-false',
          name: 'Unmanaged False',
          price: 100,
          manage_stock: false,
          stock: 0,
          stock_quantity: 0,
          product_categories: [{ categories: { slug: 'phones' } }],
        },
        expectedStock: null,
        expectedManageStock: false,
      },
      {
        label: 'managed with null',
        row: {
          slug: 'managed-null',
          name: 'Managed Null',
          price: 100,
          manage_stock: null,
          stock: 0,
          stock_quantity: 0,
          product_categories: [{ categories: { slug: 'phones' } }],
        },
        expectedStock: 0,
        expectedManageStock: null,
      },
      {
        label: 'tracked zero stock with true',
        row: {
          slug: 'tracked-zero',
          name: 'Tracked Zero',
          price: 100,
          manage_stock: true,
          stock: 0,
          stock_quantity: 0,
          product_categories: [{ categories: { slug: 'phones' } }],
        },
        expectedStock: 0,
        expectedManageStock: true,
      },
      {
        label: 'tracked positive stock with true',
        row: {
          slug: 'tracked-positive',
          name: 'Tracked Positive',
          price: 100,
          manage_stock: true,
          stock: 0,
          stock_quantity: 5,
          product_categories: [{ categories: { slug: 'phones' } }],
        },
        expectedStock: 5,
        expectedManageStock: true,
      },
      {
        label:
          'omitted manage_stock with zero stock (strict projection fallback)',
        row: {
          slug: 'omitted-zero',
          name: 'Omitted Zero',
          price: 100,
          stock: 0,
          stock_quantity: 0,
          product_categories: [{ categories: { slug: 'phones' } }],
        },
        expectedStock: 0,
        expectedManageStock: undefined,
      },
      {
        label: 'omitted manage_stock with positive stock',
        row: {
          slug: 'omitted-positive',
          name: 'Omitted Positive',
          price: 100,
          stock: 0,
          stock_quantity: 8,
          product_categories: [{ categories: { slug: 'phones' } }],
        },
        expectedStock: 8,
        expectedManageStock: undefined,
      },
      {
        label:
          'legacy positive stock with zero stock_quantity and manage_stock true',
        row: {
          slug: 'legacy-positive',
          name: 'Legacy Positive',
          price: 100,
          manage_stock: true,
          stock: 9,
          stock_quantity: 0,
          product_categories: [{ categories: { slug: 'phones' } }],
        },
        expectedStock: 9,
        expectedManageStock: true,
      },
    ])('resolves candidate stock for $label', async ({
      row,
      expectedStock,
      expectedManageStock,
    }) => {
      const productsQuery = createProductsQuery({
        data: [row],
        error: null,
      });
      mockGetPublicSupabaseClient.mockReturnValue({
        from: vi.fn(() => productsQuery),
      });

      const result = await getCachedProductSemanticInventory(
        'merchant-1',
        'phones'
      );
      expect(result).toHaveLength(1);
      expect(result[0]?.stock).toBe(expectedStock);
      expect(result[0]?.manage_stock).toBe(expectedManageStock);
    });
  });
});
