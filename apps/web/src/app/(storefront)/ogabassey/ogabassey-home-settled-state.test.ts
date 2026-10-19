import { AsyncLocalStorage } from 'node:async_hooks';
import { createElement, isValidElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const requestCacheStorage = new AsyncLocalStorage<Map<unknown, unknown>>();

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  let fallbackStore = new Map<unknown, unknown>();
  return {
    ...actual,
    cache: <T extends (...args: never[]) => unknown>(fn: T) => {
      return ((...args: never[]) => {
        const store = requestCacheStorage.getStore() ?? fallbackStore;
        if (!store.has(fn)) {
          store.set(fn, fn(...args));
        }
        return store.get(fn) as ReturnType<T>;
      }) as T;
    },
    __resetFallbackCacheForTest: () => {
      fallbackStore = new Map<unknown, unknown>();
    },
  };
});

vi.mock('@/components/storefront/ogabassey/components/Hero', () => ({
  Hero: () => createElement('section', { 'aria-label': 'Product hero' }),
}));

vi.mock('./ogabassey-home-dynamic-content', () => ({
  OgabasseyHomeDynamicContent: () =>
    createElement('section', { 'aria-label': 'Dynamic content' }),
}));

vi.mock('./ogabassey-home-hero-shell-data', () => ({
  resolveOgabasseyHomeHeroShell: vi.fn(() => Promise.resolve(null)),
}));

vi.mock('@/lib/cached-data', () => ({
  getRequestScopedMerchant: vi.fn(() => Promise.resolve(null)),
}));

describe('ogabassey-home-settled-state', () => {
  beforeEach(async () => {
    vi.resetModules();
    const reactMod = (await import('react')) as unknown as {
      __resetFallbackCacheForTest?: () => void;
    };
    reactMod.__resetFallbackCacheForTest?.();
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

  it('isolates settled state across concurrent requests with distinct merchants', async () => {
    const {
      hydrateSettledCanonicalOgabasseyHomeStateFromParams,
      peekSettledCanonicalOgabasseyHomeState,
      recordSettledCanonicalOgabasseyHomeState,
    } = await import('./ogabassey-home-settled-state');

    const paramsCanonical = Promise.resolve({ slug: 'ogabassey.com' });
    const paramsOther = Promise.resolve({ slug: 'other-store' });

    const [canonicalResult, otherResult] = await Promise.all([
      requestCacheStorage.run(new Map(), async () => {
        recordSettledCanonicalOgabasseyHomeState({
          heroShell: {
            status: 'published',
            merchantId: 'merchant-ogabassey',
            slides: [],
          },
          merchant: {
            id: 'merchant-ogabassey',
            is_published: true,
          } as never,
          params: paramsCanonical,
          slug: 'ogabassey.com',
        });
        await Promise.resolve();
        return peekSettledCanonicalOgabasseyHomeState();
      }),
      requestCacheStorage.run(new Map(), async () => {
        await Promise.resolve();
        return {
          hydrated:
            hydrateSettledCanonicalOgabasseyHomeStateFromParams(paramsOther),
          peeked: peekSettledCanonicalOgabasseyHomeState(),
        };
      }),
    ]);

    expect(canonicalResult?.slug).toBe('ogabassey.com');
    expect(canonicalResult?.merchant?.id).toBe('merchant-ogabassey');
    expect(otherResult.hydrated).toBeNull();
    expect(otherResult.peeked).toBeNull();
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
