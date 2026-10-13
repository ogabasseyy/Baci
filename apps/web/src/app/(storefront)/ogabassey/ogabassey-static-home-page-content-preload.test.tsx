import { render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/components/seo/json-ld', () => ({
  JsonLd: () => <script type="application/ld+json" />,
}));
vi.mock('./ogabassey-home-style-loader', () => ({
  OgabasseyHomeStyleLoader: () => <style data-testid="style-loader" />,
}));
const mockDynamicContentSuspends = vi.hoisted(() => ({ value: false }));
vi.mock('./ogabassey-home-page-content', () => ({
  OgabasseyHomePageContent: ({
    omitDocumentHeading,
    omitMobileCarousel,
    pathPrefix,
    shellMerchantId,
    shellSlides,
  }: {
    omitDocumentHeading?: boolean;
    omitMobileCarousel?: boolean;
    pathPrefix: string;
    shellMerchantId: string | null;
    shellSlides: unknown[] | null;
  }) => {
    if (mockDynamicContentSuspends.value) {
      // Suspend forever so only the committed sibling remains visible.
      throw new Promise(() => undefined);
    }
    return (
      <section
        aria-label="Dynamic home content"
        data-omit-document-heading={omitDocumentHeading ? 'true' : 'false'}
        data-omit-mobile-carousel={omitMobileCarousel ? 'true' : 'false'}
        data-prefix={pathPrefix}
        data-shell-merchant-id={shellMerchantId ?? 'none'}
        data-shell-slide-count={shellSlides?.length ?? 'none'}
      />
    );
  },
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

vi.mock('next/image', () => ({
  getImageProps: ({ src, alt }: { alt: string; src: string }) => ({
    props: {
      alt,
      src,
      srcSet: `${src} 640w`,
      sizes: '40vw',
    },
  }),
}));

const mockCriticalHero = vi.hoisted(() => vi.fn());
vi.mock('@/components/storefront/ogabassey/components/Hero', () => ({
  Hero: (props: { slides: unknown[] }) => {
    mockCriticalHero(props);
    return (
      <section
        aria-label="Permanent critical hero"
        data-slide-count={props.slides.length}
      />
    );
  },
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

describe('OgabasseyStaticHomePageContent preload', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    // The streaming Suspense fallback renders the utility panel for
    // geometry; its engagement effect needs matchMedia like the panel's
    // own tests provide.
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({ matches: false }))
    );
    mockDynamicContentSuspends.value = false;
    mockResolveHeroShell.mockResolvedValue({
      status: 'published',
      merchantId: 'merchant-1',
      slides: [SHELL_SLIDE],
    });
  });

  it('preloads the cached public asset without rendering shopping UI', async () => {
    render(await OgabasseyStaticHomePageContent({ pathPrefix: '' }));

    expect(mockPreloadHeroResources).toHaveBeenCalledWith(SHELL_SLIDE.imageUrl);
  });

  it('renders a scanner-visible preload link for the committed hero image', async () => {
    render(await OgabasseyStaticHomePageContent({ pathPrefix: '' }));

    const link = document.querySelector(
      'link[data-ogabassey-home-hero-preload="true"]'
    );
    expect(link).toBeInTheDocument();
    expect(link?.getAttribute('rel')).toBe('preload');
    expect(link?.getAttribute('as')).toBe('image');
    expect(link?.getAttribute('fetchpriority')).toBe('high');
  });
});
