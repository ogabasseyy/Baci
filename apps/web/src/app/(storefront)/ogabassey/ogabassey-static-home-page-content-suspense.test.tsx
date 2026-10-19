import { render, screen } from '@testing-library/react';
import { Suspense, use } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./ogabassey-home-static-shell-head', () => ({
  OgabasseyHomeStaticShellHead: () => (
    <span data-testid="ogabassey-home-static-shell-head" />
  ),
}));

vi.mock('./ogabassey-home-page-content', () => ({
  OgabasseyHomePageContent: () => {
    use(new Promise<never>(() => {}));
    return <div />;
  },
}));

const mockResolveHeroShell = vi.hoisted(() => vi.fn());
vi.mock('./ogabassey-home-hero-shell-data', () => ({
  resolveOgabasseyHomeHeroShell: (...args: unknown[]) =>
    mockResolveHeroShell(...args),
}));

vi.mock('./ogabassey-home-hero-resource-hints', () => ({
  preloadOgabasseyHomeHeroResources: vi.fn(),
}));

import { OgabasseyStaticHomePageContent } from './ogabassey-static-home-page-content';

const SHELL_SLIDE = {
  kind: 'product' as const,
  id: 'p1',
  name: 'Tecno Spark 40 Pro',
  priceLabel: '₦250,000',
  href: '/smartphones/tecno-spark-40-pro',
  imageUrl: 'https://cdn.ogabassey.com/core-assets/products/tecno.avif',
  imageAlt: 'Tecno Spark 40 Pro',
  ctaLabel: 'Shop now',
};

describe('OgabasseyStaticHomePageContent suspense boundaries', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({ matches: false }))
    );
    mockResolveHeroShell.mockResolvedValue({
      status: 'published',
      merchantId: 'merchant-1',
      slides: [SHELL_SLIDE],
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('delegates suspension to the outer shell boundary when omitCommittedHero is true instead of rendering a redundant inner hero reserve', async () => {
    const element = await OgabasseyStaticHomePageContent({
      omitCommittedHero: true,
      pathPrefix: '',
    });

    render(
      <Suspense fallback={<div data-testid="outer-shell-reserve" />}>
        {element}
      </Suspense>
    );

    expect(screen.getByTestId('outer-shell-reserve')).toBeInTheDocument();
    expect(
      document.querySelector(
        '[data-ogabassey-home-hero-reserve-fallback="true"]'
      )
    ).not.toBeInTheDocument();
  });

  it('catches suspension in its own inner hero-reserve Suspense boundary when omitCommittedHero is false', async () => {
    const element = await OgabasseyStaticHomePageContent({
      omitCommittedHero: false,
      pathPrefix: '',
    });

    render(
      <Suspense fallback={<div data-testid="outer-shell-reserve" />}>
        {element}
      </Suspense>
    );

    expect(
      document.querySelector(
        '[data-ogabassey-home-hero-reserve-fallback="true"]'
      )
    ).toBeInTheDocument();
    expect(screen.queryByTestId('outer-shell-reserve')).not.toBeInTheDocument();
  });
});
