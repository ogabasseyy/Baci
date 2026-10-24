import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { markStorefrontPageParams } from '@/app/(storefront)/ogabassey/ogabassey-home-settled-state';
import { OGABASSEY_DESCRIPTION, OGABASSEY_TITLE } from '@/config/ogabassey';
import { OgabasseyHomeCommittedLcp } from './ogabassey-home-committed-lcp';

const mockResolveHeroShell = vi.hoisted(() => vi.fn());
const mockGetRequestScopedMerchant = vi.hoisted(() => vi.fn());
vi.mock('@/app/(storefront)/ogabassey/ogabassey-home-hero-shell-data', () => ({
  resolveOgabasseyHomeHeroShell: (...args: unknown[]) =>
    mockResolveHeroShell(...args),
}));
vi.mock('@/lib/cached-data', () => ({
  getRequestScopedMerchant: (...args: unknown[]) =>
    mockGetRequestScopedMerchant(...args),
}));

describe('OgabasseyHomeCommittedLcp', () => {
  beforeEach(() => {
    mockResolveHeroShell.mockReset();
    mockResolveHeroShell.mockResolvedValue(null);
    mockGetRequestScopedMerchant.mockReset();
    mockGetRequestScopedMerchant.mockResolvedValue(null);
  });

  it('provides document semantics without a second visible banner', async () => {
    render(
      await OgabasseyHomeCommittedLcp({
        params: Promise.resolve({ slug: 'ogabassey.com' }),
      })
    );

    expect(screen.queryByText(OGABASSEY_DESCRIPTION)).not.toBeInTheDocument();
    expect(screen.getAllByRole('heading')).toHaveLength(1);
    expect(
      screen.getByRole('heading', { level: 1, name: OGABASSEY_TITLE })
    ).toHaveClass('sr-only');
    for (const role of ['img', 'link', 'button', 'region']) {
      expect(screen.queryByRole(role)).not.toBeInTheDocument();
    }
  });

  it('renders nothing for other storefronts', async () => {
    const ui = await OgabasseyHomeCommittedLcp({
      params: Promise.resolve({ slug: 'another-shop' }),
    });

    expect(ui).toBeNull();
    expect(mockResolveHeroShell).not.toHaveBeenCalled();
  });

  it('streams the critical shell without waiting for the shell lookup', async () => {
    mockResolveHeroShell.mockReturnValue(new Promise(() => {}));
    // The slot itself awaits params only, so this resolves while the
    // lookup is still pending.
    const ui = await OgabasseyHomeCommittedLcp({
      params: Promise.resolve({ slug: 'ogabassey.com' }),
    });
    render(ui);

    expect(
      screen.getByRole('heading', { level: 1, name: OGABASSEY_TITLE })
    ).toBeInTheDocument();
  });

  it('emits hint bytes only, never a renderable image', async () => {
    const { container } = render(
      await OgabasseyHomeCommittedLcp({
        params: Promise.resolve({ slug: 'ogabassey' }),
      })
    );

    expect(container.querySelector('img, picture, source')).toBeNull();
  });

  it('propagates Next.js framework interrupts during canonical homepage settlement while degrading ordinary merchant errors to null', async () => {
    const interruptParams = Promise.resolve({ slug: 'ogabassey.com' });
    markStorefrontPageParams(interruptParams);

    const notFoundInterrupt = Object.assign(
      new Error('NEXT_HTTP_ERROR_FALLBACK;404'),
      {
        digest: 'NEXT_HTTP_ERROR_FALLBACK;404',
      }
    );
    mockGetRequestScopedMerchant.mockRejectedValueOnce(notFoundInterrupt);

    await expect(
      OgabasseyHomeCommittedLcp({ params: interruptParams })
    ).rejects.toThrow('NEXT_HTTP_ERROR_FALLBACK;404');

    const degradedParams = Promise.resolve({ slug: 'ogabassey.com' });
    markStorefrontPageParams(degradedParams);
    mockGetRequestScopedMerchant.mockRejectedValueOnce(
      new Error('transient db failure')
    );

    await expect(
      OgabasseyHomeCommittedLcp({ params: degradedParams })
    ).resolves.toBeNull();
  });
});
