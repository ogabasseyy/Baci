import { Buffer } from 'node:buffer';
import { render, screen } from '@testing-library/react';
import type { ReactElement } from 'react';
import { prerender } from 'react-dom/static';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OGABASSEY_DESCRIPTION, OGABASSEY_TITLE } from '@/config/ogabassey';
import { OgabasseyHomeCommittedLcp } from './ogabassey-home-committed-lcp';

const mockResolveHeroShell = vi.hoisted(() => vi.fn());
vi.mock('@/app/(storefront)/ogabassey/ogabassey-home-hero-shell-data', () => ({
  resolveOgabasseyHomeHeroShell: (...args: unknown[]) =>
    mockResolveHeroShell(...args),
}));

const LENOVO_SLIDE_ZERO_URL =
  'https://cdn.ogabassey.com/core-assets/products/used-laptops/loq-gaming-red-circle.png?v=20260927';

/** Fully resolve server Suspense (jsdom cannot settle async children). */
async function renderServerMarkup(ui: ReactElement | null): Promise<string> {
  if (ui === null) {
    throw new Error('CommittedLcp rendered null for an ogabassey slug');
  }
  const { prelude } = await prerender(ui);
  const chunks: Buffer[] = [];
  for await (const chunk of prelude as unknown as AsyncIterable<Uint8Array>) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf8');
}

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

  it('preloads the live slide-0 so the hint matches the rendered hero', async () => {
    mockResolveHeroShell.mockResolvedValue({
      status: 'published',
      merchantId: 'merchant-1',
      slides: [{ imageUrl: LENOVO_SLIDE_ZERO_URL }],
    });
    const html = await renderServerMarkup(
      await OgabasseyHomeCommittedLcp({
        params: Promise.resolve({ slug: 'ogabassey.com' }),
      })
    );

    expect(html).toContain('data-ogabassey-home-hero-preload');
    expect(html).toContain('loq-gaming-red-circle');
    expect(html).not.toContain('dell-alienware-m18-r2.jpg');
  });

  it.each([
    ['a shell lookup miss', null],
    ['an unpublished merchant', { status: 'unpublished' }],
    [
      'published without slides',
      { status: 'published', merchantId: 'm', slides: [] },
    ],
  ])('emits no guessed-image preload on %s', async (_case, shell) => {
    mockResolveHeroShell.mockResolvedValue(shell);
    const html = await renderServerMarkup(
      await OgabasseyHomeCommittedLcp({
        params: Promise.resolve({ slug: 'ogabassey.com' }),
      })
    );

    expect(html).not.toContain('data-ogabassey-home-hero-preload');
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
