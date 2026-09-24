import { beforeEach, describe, expect, it, vi } from 'vitest';

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
const mockSupabase = {
  from: vi.fn(() => mockProductsQuery),
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

const { default: QuizDashboardPage } = await import('./page');

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
});
