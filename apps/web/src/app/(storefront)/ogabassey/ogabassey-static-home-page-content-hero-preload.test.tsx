import { render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OGABASSEY_HOME_COMMITTED_HERO_IMAGE_URL } from '@/config/ogabassey';

vi.mock('@/components/seo/json-ld', () => ({
  JsonLd: () => null,
}));

vi.mock('./ogabassey-home-style-loader', () => ({
  OgabasseyHomeStyleLoader: () => null,
}));

vi.mock('./ogabassey-home-page-content', () => ({
  OgabasseyHomePageContent: () => <div data-testid="home-page-content" />,
}));

const mockResolveHeroShell = vi.hoisted(() => vi.fn());
vi.mock('./ogabassey-home-hero-shell-data', () => ({
  resolveOgabasseyHomeHeroShell: (...args: unknown[]) =>
    mockResolveHeroShell(...args),
}));

const mockPreloadHeroResources = vi.hoisted(() => vi.fn());
vi.mock('./ogabassey-home-hero-resource-hints', () => ({
  preloadOgabasseyHomeHeroResources: (...args: unknown[]) =>
    mockPreloadHeroResources(...args),
}));

import { OgabasseyStaticHomePageContent } from './ogabassey-static-home-page-content';

const ROTATED_SLIDE = {
  kind: 'product' as const,
  id: 'p1',
  name: 'Tecno Spark 40 Pro',
  priceLabel: '₦250,000',
  href: '/smartphones/tecno-spark-40-pro',
  imageUrl: 'https://cdn.ogabassey.com/core-assets/products/tecno.avif',
  imageAlt: 'Tecno Spark 40 Pro',
  ctaLabel: 'Shop now',
};

function mockPublishedShell(imageUrl: string) {
  mockResolveHeroShell.mockResolvedValue({
    status: 'published',
    merchantId: 'merchant-1',
    slides: [{ ...ROTATED_SLIDE, imageUrl }],
  });
}

describe('OgabasseyStaticHomePageContent hero preload ownership', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('emits the deduped preload when live slide-0 matches the committed constant in standalone mode', async () => {
    // Standalone composition (`omitCommittedHero` false): there is no upstream
    // committed slot, so `OgabasseyHomeHeroPreloadLink` must still emit the
    // single deduped `ReactDOM.preload` hint for the committed constant URL.
    mockPublishedShell(OGABASSEY_HOME_COMMITTED_HERO_IMAGE_URL);
    render(await OgabasseyStaticHomePageContent({ pathPrefix: '/ogabassey' }));

    expect(mockPreloadHeroResources).toHaveBeenCalledTimes(1);
    expect(mockPreloadHeroResources).toHaveBeenCalledWith(
      OGABASSEY_HOME_COMMITTED_HERO_IMAGE_URL
    );
    expect(
      document.querySelector('link[data-ogabassey-home-hero-preload="true"]')
    ).not.toBeInTheDocument();
  });

  it('emits the deduped preload when live slide-0 rotated away in standalone mode', async () => {
    mockPublishedShell(ROTATED_SLIDE.imageUrl);
    render(await OgabasseyStaticHomePageContent({ pathPrefix: '/ogabassey' }));

    expect(mockPreloadHeroResources).toHaveBeenCalledTimes(1);
    expect(mockPreloadHeroResources).toHaveBeenCalledWith(
      ROTATED_SLIDE.imageUrl
    );
    expect(
      document.querySelector('link[data-ogabassey-home-hero-preload="true"]')
    ).not.toBeInTheDocument();
  });

  it('emits no downstream hints when the committed slot owns the preload', async () => {
    // Static-page composition: the upstream committed slot already emits a
    // scanner-visible <link> for the live slide-0 URL, so the downstream
    // link and the rotation flight hint must both stay silent.
    mockPublishedShell(ROTATED_SLIDE.imageUrl);
    render(
      await OgabasseyStaticHomePageContent({
        omitCommittedHero: true,
        pathPrefix: '/ogabassey',
      })
    );

    expect(mockPreloadHeroResources).not.toHaveBeenCalled();
    expect(
      document.querySelector('link[data-ogabassey-home-hero-preload="true"]')
    ).not.toBeInTheDocument();
  });

  it('emits no downstream link when the committed slot owns an unrotated URL', async () => {
    mockPublishedShell(OGABASSEY_HOME_COMMITTED_HERO_IMAGE_URL);
    render(
      await OgabasseyStaticHomePageContent({
        omitCommittedHero: true,
        pathPrefix: '/ogabassey',
      })
    );

    expect(mockPreloadHeroResources).not.toHaveBeenCalled();
    expect(
      document.querySelector('link[data-ogabassey-home-hero-preload="true"]')
    ).not.toBeInTheDocument();
  });
});
