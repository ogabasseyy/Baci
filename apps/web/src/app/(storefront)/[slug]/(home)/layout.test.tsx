import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveOgabasseyHomeHeroShell } from '@/app/(storefront)/ogabassey/ogabassey-home-hero-shell-data';
import { hydrateSettledCanonicalOgabasseyHomeStateFromParams } from '@/app/(storefront)/ogabassey/ogabassey-home-settled-state';
import { getRequestScopedMerchant } from '@/lib/cached-data';
import StorefrontFullCssLayout from './layout';

vi.mock('@/app/(storefront)/ogabassey/ogabassey-home-hero-shell-data', () => ({
  resolveOgabasseyHomeHeroShell: vi.fn(),
}));

vi.mock('@/lib/cached-data', () => ({
  getRequestScopedMerchant: vi.fn(),
}));

describe('StorefrontFullCssLayout', () => {
  beforeEach(() => {
    vi.mocked(resolveOgabasseyHomeHeroShell).mockReset();
    vi.mocked(getRequestScopedMerchant).mockReset();
  });

  it('returns children synchronously when params are omitted', () => {
    const result = StorefrontFullCssLayout({
      children: <div>Home child</div>,
    });

    render(result);
    expect(screen.getByText('Home child')).toBeInTheDocument();
    expect(resolveOgabasseyHomeHeroShell).not.toHaveBeenCalled();
  });

  it('settles canonical OgaBassey home state into the request box before rendering children', async () => {
    vi.mocked(getRequestScopedMerchant).mockResolvedValue({
      id: 'merchant-1',
      is_published: true,
    } as never);
    vi.mocked(resolveOgabasseyHomeHeroShell).mockResolvedValue({
      status: 'published',
      merchantId: 'merchant-1',
      slides: [],
    });

    const params = Promise.resolve({ slug: 'ogabassey.com' });
    const element = await StorefrontFullCssLayout({
      children: <div>Canonical home</div>,
      params,
    });

    render(element);
    expect(screen.getByText('Canonical home')).toBeInTheDocument();
    expect(hydrateSettledCanonicalOgabasseyHomeStateFromParams(params)).toEqual(
      {
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
      }
    );
  });

  it('does not fetch canonical OgaBassey hero shell for non-canonical storefronts', async () => {
    const params = Promise.resolve({ slug: 'other-store' });
    const element = await StorefrontFullCssLayout({
      children: <div>Other home</div>,
      params,
    });

    render(element);
    expect(screen.getByText('Other home')).toBeInTheDocument();
    expect(resolveOgabasseyHomeHeroShell).not.toHaveBeenCalled();
    expect(getRequestScopedMerchant).not.toHaveBeenCalled();
  });
});
