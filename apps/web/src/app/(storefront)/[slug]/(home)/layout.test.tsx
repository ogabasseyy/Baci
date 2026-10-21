import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockResolveOgabasseyHomeHeroShell = vi.hoisted(() => vi.fn());
const mockGetRequestScopedMerchant = vi.hoisted(() => vi.fn());

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  return {
    ...actual,
    cache: <T extends (...args: never[]) => unknown>(fn: T) => {
      let memoized: ReturnType<T> | undefined;
      return ((...args: never[]) => {
        if (memoized === undefined) {
          memoized = fn(...args) as ReturnType<T>;
        }
        return memoized;
      }) as T;
    },
  };
});

vi.mock('@/app/(storefront)/ogabassey/ogabassey-home-hero-shell-data', () => ({
  resolveOgabasseyHomeHeroShell: () => mockResolveOgabasseyHomeHeroShell(),
}));

vi.mock('@/lib/cached-data', () => ({
  getRequestScopedMerchant: (slug: string) =>
    mockGetRequestScopedMerchant(slug),
}));

describe('StorefrontFullCssLayout (home)', () => {
  beforeEach(() => {
    vi.resetModules();
    mockResolveOgabasseyHomeHeroShell.mockReset();
    mockGetRequestScopedMerchant.mockReset();
  });

  it('settles canonical ogabassey.com home state before returning children', async () => {
    mockResolveOgabasseyHomeHeroShell.mockResolvedValue({
      status: 'published',
      merchantId: 'merchant-1',
      slides: [],
    });
    mockGetRequestScopedMerchant.mockResolvedValue({
      id: 'merchant-1',
      is_published: true,
    });

    const { default: StorefrontFullCssLayout } = await import('./layout');
    const { peekSettledCanonicalOgabasseyHomeState } = await import(
      '@/app/(storefront)/ogabassey/ogabassey-home-settled-state'
    );

    const child = <div data-testid="home-child" />;
    const result = await StorefrontFullCssLayout({
      children: child,
      params: Promise.resolve({ slug: 'ogabassey.com' }),
    });

    expect(result).toBe(child);
    expect(mockResolveOgabasseyHomeHeroShell).toHaveBeenCalledOnce();
    expect(mockGetRequestScopedMerchant).toHaveBeenCalledWith('ogabassey.com');
    expect(peekSettledCanonicalOgabasseyHomeState()).toEqual({
      heroShell: {
        status: 'published',
        merchantId: 'merchant-1',
        slides: [],
      },
      heroShellSettled: true,
      merchant: {
        id: 'merchant-1',
        is_published: true,
      },
      merchantSettled: true,
      slug: 'ogabassey.com',
    });
  });

  it('skips canonical home settlement for non-canonical storefront slugs', async () => {
    const { default: StorefrontFullCssLayout } = await import('./layout');
    const { peekSettledCanonicalOgabasseyHomeState } = await import(
      '@/app/(storefront)/ogabassey/ogabassey-home-settled-state'
    );

    const child = <div data-testid="home-child" />;
    const result = await StorefrontFullCssLayout({
      children: child,
      params: Promise.resolve({ slug: 'ogabassey' }),
    });

    expect(result).toBe(child);
    expect(mockResolveOgabasseyHomeHeroShell).not.toHaveBeenCalled();
    expect(mockGetRequestScopedMerchant).not.toHaveBeenCalled();
    expect(peekSettledCanonicalOgabasseyHomeState()).toBeNull();
  });
});
