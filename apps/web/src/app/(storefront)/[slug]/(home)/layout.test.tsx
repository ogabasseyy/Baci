import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockResolveOgabasseyHomeHeroShell = vi.hoisted(() => vi.fn());
const mockGetRequestScopedMerchant = vi.hoisted(() => vi.fn());

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

  it('acts as a synchronous pass-through and returns children without awaiting hero data', async () => {
    const { default: StorefrontFullCssLayout } = await import('./layout');

    const child = <div data-testid="home-child" />;
    const result = StorefrontFullCssLayout({
      children: child,
      params: Promise.resolve({ slug: 'ogabassey.com' }),
    });

    expect(result).toBe(child);
    expect(mockResolveOgabasseyHomeHeroShell).not.toHaveBeenCalled();
    expect(mockGetRequestScopedMerchant).not.toHaveBeenCalled();
  });
});
