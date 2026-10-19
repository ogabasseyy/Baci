import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OGABASSEY_DESCRIPTION, OGABASSEY_TITLE } from '@/config/ogabassey';
import { OgabasseyHomeCommittedLcp } from './ogabassey-home-committed-lcp';

const mockResolveHeroShell = vi.hoisted(() => vi.fn());
vi.mock('@/app/(storefront)/ogabassey/ogabassey-home-hero-shell-data', () => ({
  resolveOgabasseyHomeHeroShell: (...args: unknown[]) =>
    mockResolveHeroShell(...args),
}));

describe('OgabasseyHomeCommittedLcp', () => {
  beforeEach(() => {
    mockResolveHeroShell.mockReset();
    mockResolveHeroShell.mockResolvedValue(null);
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
});
