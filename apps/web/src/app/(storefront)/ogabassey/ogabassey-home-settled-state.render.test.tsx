import { isValidElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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

vi.mock('@/components/storefront/ogabassey/components/Hero', () => ({
  Hero: () => <section aria-label="Product hero" />,
}));

vi.mock('./ogabassey-home-dynamic-content', () => ({
  OgabasseyHomeDynamicContent: () => <section aria-label="Dynamic content" />,
}));

vi.mock('./ogabassey-home-hero-shell-data', () => ({
  resolveOgabasseyHomeHeroShell: vi.fn(() => Promise.resolve(null)),
}));

vi.mock('@/lib/cached-data', () => ({
  getRequestScopedMerchant: vi.fn(() => Promise.resolve(null)),
}));

describe('ogabassey-home-settled-state', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('returns null before any canonical homepage state is recorded', async () => {
    const {
      hydrateSettledCanonicalOgabasseyHomeStateFromParams,
      peekSettledCanonicalOgabasseyHomeState,
    } = await import('./ogabassey-home-settled-state');

    expect(peekSettledCanonicalOgabasseyHomeState()).toBeNull();
    expect(
      hydrateSettledCanonicalOgabasseyHomeStateFromParams(
        Promise.resolve({ slug: 'ogabassey.com' })
      )
    ).toBeNull();
  });

  it('records and reads settled canonical homepage state in the current request box', async () => {
    const {
      peekSettledCanonicalOgabasseyHomeState,
      recordSettledCanonicalOgabasseyHomeState,
    } = await import('./ogabassey-home-settled-state');

    const params = Promise.resolve({ slug: 'ogabassey.com' });
    recordSettledCanonicalOgabasseyHomeState({
      heroShell: { status: 'published', merchantId: 'merchant-1', slides: [] },
      merchant: {
        id: 'merchant-1',
        is_published: true,
      } as never,
      params,
      slug: 'ogabassey.com',
    });

    expect(peekSettledCanonicalOgabasseyHomeState()).toEqual({
      heroShell: { status: 'published', merchantId: 'merchant-1', slides: [] },
      heroShellSettled: true,
      merchant: {
        id: 'merchant-1',
        is_published: true,
      },
      merchantSettled: true,
      slug: 'ogabassey.com',
    });
  });

  it('hydrates settled state from a shared params promise reference across cache scopes', async () => {
    const params = Promise.resolve({ slug: 'ogabassey.com' });
    const firstScope = await import('./ogabassey-home-settled-state');
    const heroShell = {
      status: 'published' as const,
      merchantId: 'merchant-1',
      slides: [],
    };
    const merchant = {
      id: 'merchant-1',
      is_published: true,
    } as unknown as Parameters<
      typeof firstScope.recordSettledCanonicalOgabasseyHomeState
    >[0]['merchant'];
    firstScope.recordSettledCanonicalOgabasseyHomeState({
      heroShell,
      merchant,
      params,
      slug: 'ogabassey.com',
    });

    const hydrated =
      firstScope.hydrateSettledCanonicalOgabasseyHomeStateFromParams(params);
    expect(hydrated).toEqual({
      heroShell,
      heroShellSettled: true,
      merchant,
      merchantSettled: true,
      slug: 'ogabassey.com',
    });
  });

  it('renders canonical homepage components synchronously without returning Promises once state is settled', async () => {
    const params = Promise.resolve({ slug: 'ogabassey.com' });
    const { recordSettledCanonicalOgabasseyHomeState } = await import(
      './ogabassey-home-settled-state'
    );
    const { OgabasseyHomeCommittedLcp } = await import(
      '../[slug]/(home)/ogabassey-home-committed-lcp'
    );
    const { OgabasseyHomeCommittedSlideZeroPreload } = await import(
      '../[slug]/(home)/ogabassey-home-committed-slide-zero-preload'
    );
    const { OgabasseyStaticHomePageContent } = await import(
      './ogabassey-static-home-page-content'
    );
    const { OgabasseyHomePageContent } = await import(
      './ogabassey-home-page-content'
    );

    const slides = [
      {
        kind: 'product' as const,
        id: 'p1',
        name: 'Galaxy Z Fold8 Case',
        priceLabel: '₦50,000',
        href: 'https://ogabassey.com/accessories/case',
        imageUrl: 'https://cdn.ogabassey.com/products/case.jpg',
        imageAlt: 'Galaxy Z Fold8 Case',
        ctaLabel: 'Buy Now',
      },
    ];

    recordSettledCanonicalOgabasseyHomeState({
      heroShell: {
        status: 'published',
        merchantId: 'merchant-1',
        slides,
      },
      merchant: {
        id: 'merchant-1',
        business_name: 'OgaBassey',
        is_published: true,
        slug: 'ogabassey',
      } as never,
      params,
      slug: 'ogabassey.com',
    });

    const committedLcpElement = OgabasseyHomeCommittedLcp({ params });
    const preloadElement = OgabasseyHomeCommittedSlideZeroPreload();
    const staticContentElement = OgabasseyStaticHomePageContent({
      omitCommittedHero: true,
      pathPrefix: '',
    });
    const pageContentElement = OgabasseyHomePageContent({
      canonicalDomain: true,
      omitDocumentHeading: true,
      pathPrefix: '',
      shellMerchantId: 'merchant-1',
      shellSlides: slides,
    });

    expect(isValidElement(committedLcpElement)).toBe(true);
    expect(committedLcpElement).not.toBeInstanceOf(Promise);
    expect(isValidElement(preloadElement)).toBe(true);
    expect(preloadElement).not.toBeInstanceOf(Promise);
    expect(isValidElement(staticContentElement)).toBe(true);
    expect(staticContentElement).not.toBeInstanceOf(Promise);
    expect(isValidElement(pageContentElement)).toBe(true);
    expect(pageContentElement).not.toBeInstanceOf(Promise);
  });
});
