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
const mockVariantsQuery = {
  eq: vi.fn(() => mockVariantsQuery),
  in: vi.fn(() => mockVariantsQuery),
  order: vi.fn(),
  select: vi.fn(() => mockVariantsQuery),
};
const mockSupabase = {
  from: vi.fn((table: string) =>
    table === 'product_variants' ? mockVariantsQuery : mockProductsQuery
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

const { default: QuizDashboardPage, loadPrizeProducts } = await import(
  './page'
);

describe('QuizDashboardPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockProductsQuery.limit.mockResolvedValue({
      data: [
        {
          default_variant_id: null,
          id: '55555555-5555-4555-8555-555555555555',
          images: [{ url: 'https://cdn.example.com/iphone.png' }],
          merchant_id: 'merchant-1',
          name: 'iPhone 15 Pro Max',
          price: 2100000,
        },
      ],
      error: null,
    });
    mockVariantsQuery.order.mockResolvedValue({ data: [], error: null });
    mockIsMerchantPermissionRedirectError.mockImplementation(
      (error: unknown) => {
        return (
          error instanceof Error &&
          error.message.startsWith('Permission denied:')
        );
      }
    );
    mockEnsurePermission.mockResolvedValue({
      merchant: { id: 'merchant-1', slug: 'ogabassey' },
    });
  });

  it('requires marketing edit permission before rendering the generator', async () => {
    const element = await QuizDashboardPage();

    expect(mockEnsurePermission).toHaveBeenCalledWith('marketing', 'edit');
    expect(mockSupabase.from).toHaveBeenCalledWith('products');
    expect(mockProductsQuery.select).toHaveBeenCalledWith(
      'id, merchant_id, name, price, images, condition, default_variant_id, has_variants, manage_stock, stock, stock_quantity',
      { count: 'exact' }
    );
    expect(
      (
        element as {
          props: {
            initialPrizeProducts: Array<{
              id: string;
              imageUrl: string | null;
            }>;
          };
        }
      ).props.initialPrizeProducts
    ).toEqual([
      expect.objectContaining({
        id: '55555555-5555-4555-8555-555555555555',
        imageUrl: 'https://cdn.example.com/iphone.png',
      }),
    ]);
    expect(mockRedirect).not.toHaveBeenCalled();
  });

  it('redirects when the merchant cannot edit marketing content', async () => {
    mockEnsurePermission.mockRejectedValueOnce(
      new Error('Permission denied: edit access to marketing is required')
    );

    await expect(QuizDashboardPage()).rejects.toThrow(
      'NEXT_REDIRECT:/dashboard'
    );
    expect(mockIsMerchantPermissionRedirectError).toHaveBeenCalledOnce();
    expect(mockRedirect).toHaveBeenCalledWith('/dashboard');
  });

  it('redirects non-Ogabassey merchants away from quiz creation', async () => {
    mockEnsurePermission.mockResolvedValueOnce({
      merchant: { id: 'merchant-2', slug: 'another-store' },
    });

    await expect(QuizDashboardPage()).rejects.toThrow(
      'NEXT_REDIRECT:/dashboard'
    );
    expect(mockRedirect).toHaveBeenCalledWith('/dashboard');
  });

  it('does not mask operational permission-loading failures', async () => {
    mockEnsurePermission.mockRejectedValueOnce(
      new Error('Database unavailable')
    );

    await expect(QuizDashboardPage()).rejects.toThrow('Database unavailable');
    expect(mockIsMerchantPermissionRedirectError).toHaveBeenCalledOnce();
    expect(mockRedirect).not.toHaveBeenCalled();
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
        {
          default_variant_id: null,
          has_variants: true,
          id: '55555555-5555-4555-8555-555555555555',
          merchant_id: 'merchant-1',
          name: 'Parent with variants',
          price: 100,
        },
        {
          default_variant_id: null,
          has_variants: true,
          id: '77777777-7777-4777-8777-777777777777',
          merchant_id: 'merchant-1',
          name: 'Parent without variants',
          price: 200,
        },
      ],
      error: null,
    });
    mockVariantsQuery.order.mockResolvedValueOnce({
      data: [
        {
          id: '66666666-6666-4666-8666-666666666666',
          merchant_id: 'merchant-1',
          product_id: '55555555-5555-4555-8555-555555555555',
          stock_quantity: 3,
        },
      ],
      error: null,
    });

    const result = await loadPrizeProducts('merchant-1');

    expect(mockSupabase.from).toHaveBeenCalledWith('product_variants');
    expect(mockVariantsQuery.in).toHaveBeenCalledWith('product_id', [
      '55555555-5555-4555-8555-555555555555',
      '77777777-7777-4777-8777-777777777777',
    ]);
    expect(result.error).toBeNull();
    expect(result.products).toHaveLength(1);
    expect(result.products[0]).toMatchObject({
      available: true,
      id: '55555555-5555-4555-8555-555555555555',
      requiresVariantSelection: false,
      variantId: '66666666-6666-4666-8666-666666666666',
    });
  });

  it('caps the serialized initial page when variant expansion overflows', async () => {
    mockProductsQuery.limit.mockResolvedValueOnce({
      count: 1,
      data: [
        {
          default_variant_id: null,
          has_variants: true,
          id: '55555555-5555-4555-8555-555555555555',
          merchant_id: 'merchant-1',
          name: 'Parent with a large matrix',
          price: 100,
        },
      ],
      error: null,
    });
    mockVariantsQuery.order.mockResolvedValueOnce({
      data: Array.from({ length: 150 }, (_, index) => ({
        id: `11111111-1111-4111-8111-${String(index).padStart(12, '0')}`,
        merchant_id: 'merchant-1',
        product_id: '55555555-5555-4555-8555-555555555555',
        stock_quantity: 1,
      })),
      error: null,
    });

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
        {
          default_variant_id: null,
          has_variants: true,
          id: '55555555-5555-4555-8555-555555555555',
          merchant_id: 'merchant-1',
          name: 'First parent',
          price: 100,
        },
        {
          default_variant_id: null,
          has_variants: true,
          id: '77777777-7777-4777-8777-777777777777',
          merchant_id: 'merchant-1',
          name: 'Second parent',
          price: 200,
        },
      ],
      error: null,
    });
    mockVariantsQuery.order.mockResolvedValueOnce({
      data: [
        ...Array.from({ length: 60 }, (_, index) => ({
          id: `11111111-1111-4111-8111-${String(index).padStart(12, '0')}`,
          merchant_id: 'merchant-1',
          product_id: '55555555-5555-4555-8555-555555555555',
          stock_quantity: 1,
        })),
        ...Array.from({ length: 60 }, (_, index) => ({
          id: `22222222-2222-4222-8222-${String(index).padStart(12, '0')}`,
          merchant_id: 'merchant-1',
          product_id: '77777777-7777-4777-8777-777777777777',
          stock_quantity: 1,
        })),
      ],
      error: null,
    });

    const result = await loadPrizeProducts('merchant-1');

    expect(result.error).toBeNull();
    expect(result.products).toHaveLength(100);
    expect(result.nextCursor).not.toBeNull();
    expect(decodePrizeProductCursor(result.nextCursor as string)).toEqual({
      productOffset: 1,
      variantOffset: 40,
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
