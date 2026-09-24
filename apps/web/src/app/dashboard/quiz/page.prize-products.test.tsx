import { beforeEach, describe, expect, it, vi } from 'vitest';
import { decodePrizeProductCursor } from '@/app/api/merchant/quiz/prize-products/prize-product-pagination';

const mockEnsurePermission = vi.fn();
const mockIsMerchantPermissionRedirectError = vi.fn((error: unknown) => {
  return (
    error instanceof Error && error.message.startsWith('Permission denied:')
  );
});
const mockRedirect = vi.fn((target: string) => {
  throw new Error(`NEXT_REDIRECT:${target}`);
});
const mockProductsQuery = {
  eq: vi.fn(() => mockProductsQuery),
  limit: vi.fn(),
  order: vi.fn(() => mockProductsQuery),
  select: vi.fn(() => mockProductsQuery),
};
const variantRowsByParent: Record<string, unknown[]> = {};
const mockVariantLimits: number[] = [];
const mockVariantProductIds: string[] = [];
function mockVariantsBuilder() {
  let productId = '';
  const builder = {
    eq: vi.fn((column: string, value: unknown) => {
      if (column === 'product_id') productId = value as string;
      return builder;
    }),
    limit: vi.fn((count: number) => {
      mockVariantLimits.push(count);
      mockVariantProductIds.push(productId);
      return Promise.resolve({
        data: (variantRowsByParent[productId] ?? []).slice(0, count),
        error: null,
      });
    }),
    order: vi.fn(() => builder),
    select: vi.fn(() => builder),
  };
  return builder;
}
const mockSupabase = {
  from: vi.fn((table: string) =>
    table === 'product_variants' ? mockVariantsBuilder() : mockProductsQuery
  ),
};
const mockCreateClient = vi.fn((_cookieStore: unknown) => mockSupabase);

vi.mock('next/headers', () => ({
  cookies: vi.fn().mockResolvedValue({ get: vi.fn() }),
}));

vi.mock('next/navigation', () => ({
  redirect: (target: string) => mockRedirect(target),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: (cookieStore: unknown) => mockCreateClient(cookieStore),
}));

vi.mock('@/lib/merchant-server', () => ({
  ensurePermission: (...args: unknown[]) => mockEnsurePermission(...args),
  isMerchantPermissionRedirectError: (error: unknown) =>
    mockIsMerchantPermissionRedirectError(error),
}));

vi.mock('./quiz-admin-client', () => ({
  QuizAdminClient: () => <div>Quiz admin client</div>,
}));

const { loadPrizeProducts } = await import('./page');

function parentRow(id: string, name: string) {
  return {
    default_variant_id: null,
    has_variants: true,
    id,
    merchant_id: 'merchant-1',
    name,
    price: 100,
  };
}

function variantRows(productId: string, prefix: string, count: number) {
  return Array.from({ length: count }, (_, index) => ({
    id: `${prefix}-${String(index).padStart(12, '0')}`,
    merchant_id: 'merchant-1',
    product_id: productId,
    stock_quantity: 1,
  }));
}

const PARENT_ID = '55555555-5555-4555-8555-555555555555';
const PARENT2_ID = '77777777-7777-4777-8777-777777777777';

describe('loadPrizeProducts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockProductsQuery.limit.mockResolvedValue({ data: [], error: null });
    for (const key of Object.keys(variantRowsByParent)) {
      delete variantRowsByParent[key];
    }
    mockVariantLimits.length = 0;
    mockVariantProductIds.length = 0;
  });

  it('filters malformed inventory rows and safely normalizes stock', async () => {
    mockProductsQuery.limit.mockResolvedValueOnce({
      count: 3,
      data: [
        {
          default_variant_id: null,
          id: '55555555-5555-4555-8555-555555555555',
          manage_stock: true,
          merchant_id: 'merchant-1',
          name: 'Safe stock product',
          price: 100,
          stock: 'not-a-number',
          stock_quantity: '-4',
        },
        {
          default_variant_id: null,
          id: 'not-a-uuid',
          merchant_id: 'merchant-1',
          name: 'Malformed product',
          price: 100,
        },
        { id: '55555555-5555-4555-8555-555555555555', name: 10 },
      ],
      error: null,
    });

    await expect(loadPrizeProducts('merchant-1')).resolves.toMatchObject({
      error: null,
      nextCursor: null,
      products: [
        expect.objectContaining({
          available: false,
          effectiveStock: 0,
          name: 'Safe stock product',
        }),
      ],
      total: 3,
    });
  });

  it('expands variant parents and omits parents without variant inventory', async () => {
    mockProductsQuery.limit.mockResolvedValueOnce({
      count: 2,
      data: [
        parentRow(PARENT_ID, 'Parent with variants'),
        parentRow(PARENT2_ID, 'Parent without variants'),
      ],
      error: null,
    });
    variantRowsByParent[PARENT_ID] = [
      {
        id: '66666666-6666-4666-8666-666666666666',
        merchant_id: 'merchant-1',
        product_id: PARENT_ID,
        stock_quantity: 3,
      },
    ];

    const result = await loadPrizeProducts('merchant-1');

    expect(mockSupabase.from).toHaveBeenCalledWith('product_variants');
    expect(mockVariantProductIds).toEqual([PARENT_ID, PARENT2_ID]);
    expect(mockVariantLimits).toEqual([101, 101]);
    expect(result.error).toBeNull();
    expect(result.products).toHaveLength(1);
    expect(result.products[0]).toMatchObject({
      available: true,
      id: PARENT_ID,
      requiresVariantSelection: false,
      variantId: '66666666-6666-4666-8666-666666666666',
    });
  });

  it('caps the serialized initial page when variant expansion overflows', async () => {
    mockProductsQuery.limit.mockResolvedValueOnce({
      count: 1,
      data: [parentRow(PARENT_ID, 'Parent with a large matrix')],
      error: null,
    });
    variantRowsByParent[PARENT_ID] = variantRows(
      PARENT_ID,
      '11111111-1111-4111-8111',
      150
    );

    const result = await loadPrizeProducts('merchant-1');

    expect(result.error).toBeNull();
    expect(result.products).toHaveLength(100);
    expect(result.nextCursor).not.toBeNull();
    expect(decodePrizeProductCursor(result.nextCursor as string)).toEqual({
      productOffset: 0,
      variantOffset: 100,
    });
  });

  it('carries the parent and variant offset across a truncated page', async () => {
    mockProductsQuery.limit.mockResolvedValueOnce({
      count: 2,
      data: [
        parentRow(PARENT_ID, 'First parent'),
        parentRow(PARENT2_ID, 'Second parent'),
      ],
      error: null,
    });
    variantRowsByParent[PARENT_ID] = variantRows(
      PARENT_ID,
      '11111111-1111-4111-8111',
      60
    );
    variantRowsByParent[PARENT2_ID] = variantRows(
      PARENT2_ID,
      '22222222-2222-4222-8222',
      60
    );

    const result = await loadPrizeProducts('merchant-1');

    expect(result.error).toBeNull();
    expect(result.products).toHaveLength(100);
    expect(result.nextCursor).not.toBeNull();
    expect(decodePrizeProductCursor(result.nextCursor as string)).toEqual({
      productOffset: 1,
      variantOffset: 40,
    });
  });

  it('hydrates a bounded chunk per round and stops at the fill point', async () => {
    const parentIds = Array.from(
      { length: 12 },
      (_, index) => `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`
    );
    mockProductsQuery.limit.mockResolvedValueOnce({
      count: 12,
      data: parentIds.map((id, index) => parentRow(id, `Parent ${index}`)),
      error: null,
    });
    parentIds.forEach((id, parentIndex) => {
      variantRowsByParent[id] = variantRows(
        id,
        `11111111-1111-4111-8${String(parentIndex).padStart(3, '0')}`,
        10
      );
    });

    const result = await loadPrizeProducts('merchant-1');

    expect(mockVariantProductIds).toHaveLength(10);
    expect(mockVariantLimits).toEqual(new Array(10).fill(101));
    expect(result.error).toBeNull();
    expect(result.products).toHaveLength(100);
    expect(result.nextCursor).not.toBeNull();
    expect(decodePrizeProductCursor(result.nextCursor as string)).toEqual({
      productOffset: 10,
      variantOffset: 0,
    });
  });

  it('returns the exact inventory total and a continuation cursor after a capped load', async () => {
    const rows = Array.from({ length: 100 }, (_, index) => ({
      default_variant_id: null,
      id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
      merchant_id: 'merchant-1',
      name: `Product ${index}`,
      price: 100,
    }));
    mockProductsQuery.limit.mockResolvedValueOnce({
      count: 101,
      data: rows,
      error: null,
    });

    await expect(loadPrizeProducts('merchant-1')).resolves.toMatchObject({
      error: null,
      nextCursor: '5050',
      total: 101,
    });
  });
});
