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

  it('skips the flight preload when live slide-0 matches the committed hint', async () => {
    // Single preload owner: the first-flush committed slot already emits
    // a scanner-visible <link> for this URL, so the flight hint would only
    // duplicate it.
    mockPublishedShell(OGABASSEY_HOME_COMMITTED_HERO_IMAGE_URL);
    render(await OgabasseyStaticHomePageContent({ pathPrefix: '/ogabassey' }));

    expect(mockPreloadHeroResources).not.toHaveBeenCalled();
  });

  it('emits the flight preload when live slide-0 rotated away', async () => {
    // The early committed hint covers a stale asset here, so the true LCP
    // image still needs its hint.
    mockPublishedShell(ROTATED_SLIDE.imageUrl);
    render(await OgabasseyStaticHomePageContent({ pathPrefix: '/ogabassey' }));

    expect(mockPreloadHeroResources).toHaveBeenCalledWith(
      ROTATED_SLIDE.imageUrl
    );
  });
});
