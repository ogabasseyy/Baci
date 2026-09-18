import { render, screen } from '@testing-library/react';
import type { ReactElement } from 'react';
import { Suspense, use } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockMerchant = {
  id: 'merchant-1',
  business_name: 'Oga & Bassey',
  business_type: 'electronics',
  email: 'hello@ogabassey.com',
  phone: '+2341234567',
  logo_url: '',
  brand_colors: undefined,
  country: 'NG',
  pages: undefined,
  slug: 'ogabassey',
  custom_domain: 'ogabassey.com',
  favicon_svg_url: undefined,
  favicon_png_32_url: undefined,
  favicon_apple_touch_url: undefined,
  social_media: undefined,
  business_address: '',
  is_published: true,
  feature_settings: {
    google_analytics_id: 'G-OGABASSEY',
  },
  template_id: 'ogabassey',
  vat_registration_status: undefined,
  vat_rate: undefined,
  hero_slides: undefined,
  mobile_hero_slides: undefined,
  site_title: '',
  site_tagline: '',
  site_description: '',
  payout_currency: 'NGN',
  plan_expires_at: null,
  plan_tier: 'pro',
  premium_features: [],
};

const {
  mockGetCachedStorefrontHomeProducts,
  mockGetStorefrontNavigationCategories,
  mockLoadOgabasseyLaunchProducts,
  mockDiscoverySection,
  mockProductSection,
} = vi.hoisted(() => ({
  mockGetCachedStorefrontHomeProducts: vi.fn(
    (_merchantId: string, _sort: string) => Promise.resolve([] as unknown[])
  ),
  mockGetStorefrontNavigationCategories: vi.fn((_merchantId: string) =>
    Promise.resolve([] as { name: string; slug: string }[])
  ),
  mockLoadOgabasseyLaunchProducts: vi.fn(
    (_merchantId: string, _currency?: unknown) =>
      Promise.resolve([] as unknown[])
  ),
  mockDiscoverySection: vi.fn(
    ({ pathPrefix }: OgabasseyHomeDiscoverySectionProps) => (
      <section aria-label="Home discovery">{pathPrefix}</section>
    )
  ),
  mockProductSection: vi.fn(
    ({ pathPrefix }: OgabasseyHomeProductSectionProps) => (
      <section aria-label="Home products">{pathPrefix}</section>
    )
  ),
}));

vi.mock('@/lib/cached-data', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    getCachedStorefrontHomeProducts: (...args: [string, string]) =>
      mockGetCachedStorefrontHomeProducts(...args),
  };
});

vi.mock('@/lib/cached-categories', () => ({
  getStorefrontNavigationCategories: (merchantId: string) =>
    mockGetStorefrontNavigationCategories(merchantId),
}));

vi.mock('./ogabassey-home-launch-products', () => ({
  loadOgabasseyLaunchProducts: (merchantId: string, currency?: unknown) =>
    mockLoadOgabasseyLaunchProducts(merchantId, currency),
}));

vi.mock('./ogabassey-home-discovery-section', () => ({
  OgabasseyHomeDiscoverySection: (props: OgabasseyHomeDiscoverySectionProps) =>
    mockDiscoverySection(props),
}));

vi.mock('./ogabassey-home-product-section', () => ({
  OgabasseyHomeProductSection: (props: OgabasseyHomeProductSectionProps) =>
    mockProductSection(props),
}));

vi.mock('@/components/analytics/analytics-pixel-provider', () => ({
  AnalyticsPixelProvider: ({
    merchant,
  }: {
    merchant?: Record<string, string | null | undefined> | null;
  }) => (
    <output aria-label="Merchant analytics">{JSON.stringify(merchant)}</output>
  ),
}));

import type { OgabasseyHomeDiscoverySectionProps } from './ogabassey-home-discovery-section';
import { OgabasseyHomeDynamicContent } from './ogabassey-home-dynamic-content';
import type { OgabasseyHomeProductSectionProps } from './ogabassey-home-product-section';

describe('OgabasseyHomeDynamicContent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetCachedStorefrontHomeProducts.mockImplementation(() =>
      Promise.resolve([])
    );
    mockGetStorefrontNavigationCategories.mockImplementation(() =>
      Promise.resolve([])
    );
    mockLoadOgabasseyLaunchProducts.mockImplementation(() =>
      Promise.resolve([])
    );
  });

  it('requests home products ordered by most recently updated', () => {
    OgabasseyHomeDynamicContent({
      merchant: mockMerchant,
      pathPrefix: '/ogabassey',
    });

    expect(mockGetCachedStorefrontHomeProducts).toHaveBeenCalledWith(
      'merchant-1',
      'recent'
    );
  });

  it('starts the category leg for the discovery section', () => {
    OgabasseyHomeDynamicContent({
      merchant: mockMerchant,
      pathPrefix: '/ogabassey',
    });

    expect(mockGetStorefrontNavigationCategories).toHaveBeenCalledWith(
      'merchant-1'
    );
  });

  it('starts the launch leg in the merchant currency for JSON-LD coverage', () => {
    OgabasseyHomeDynamicContent({
      merchant: { ...mockMerchant, payout_currency: 'INR', country: 'IN' },
      pathPrefix: '/ogabassey',
    });

    expect(mockLoadOgabasseyLaunchProducts).toHaveBeenCalledWith(
      'merchant-1',
      expect.objectContaining({ code: 'INR' })
    );
  });

  it('streams the product grid ahead of the enrichment legs', async () => {
    // Creating the element tree starts every leg without awaiting any of
    // them; each Suspense boundary then flushes the moment its own inputs
    // resolve, so a slow category/launch leg can no longer hold back the
    // product grid.
    const result = OgabasseyHomeDynamicContent({
      merchant: mockMerchant,
      pathPrefix: '/ogabassey',
    }) as ReactElement;

    render(result);

    expect(mockProductSection).toHaveBeenCalledOnce();
    expect(mockDiscoverySection).toHaveBeenCalledOnce();
    // Mock params carry the real section prop types, so the legs are
    // asserted through the production contract, not a redeclared shape.
    const productProps = mockProductSection.mock.calls[0]?.[0];
    const discoveryProps = mockDiscoverySection.mock.calls[0]?.[0];
    expect(productProps.productsPromise).toBeInstanceOf(Promise);
    expect(discoveryProps.categoriesPromise).toBeInstanceOf(Promise);
    expect(discoveryProps.launchProductsPromise).toBeInstanceOf(Promise);
    // One shared home-product fetch feeds both halves (no duplicate query).
    expect(discoveryProps.productsPromise).toBe(productProps.productsPromise);
    await expect(productProps.productsPromise).resolves.toEqual([]);
  });

  it('isolates each half in its own Suspense boundary with a CLS-safe fallback', () => {
    // No `as ReactElement`: the inferred element type keeps `.props`
    // accessible for tree inspection (the imported ReactElement type does
    // not expose it under this repo's React 19 types).
    const result = OgabasseyHomeDynamicContent({
      merchant: mockMerchant,
      pathPrefix: '/ogabassey',
    });

    // Structural probe: two Suspense boundaries with geometry-matched
    // reserves — the median full product grid and the median discovery
    // card — so whichever leg loses the streaming race inserts near-exact
    // instead of pushing a viewport-visible footer down.
    const children = (
      Array.isArray(result.props.children)
        ? result.props.children
        : [result.props.children]
    ) as Array<{
      type?: unknown;
      props?: {
        children?: { props?: Record<string, unknown> };
        fallback?: null | {
          props?: Record<string, unknown> & {
            children?: { props?: Record<string, unknown> };
          };
        };
      };
    }>;
    const boundaries = children.filter((child) => child?.type === Suspense);
    expect(boundaries).toHaveLength(2);
    for (const [index, marker, minHeight] of [
      [0, 'data-ogabassey-product-reserve', 'min-h-[1200px]'],
      [1, 'data-ogabassey-discovery-reserve', 'min-h-[280px]'],
    ] as [number, string, string][]) {
      const fallback = boundaries[index]?.props?.fallback;
      expect(fallback).not.toBeNull();
      const reserve = (
        fallback as {
          props: Record<string, unknown> & {
            children: { props: Record<string, unknown> };
          };
        }
      ).props;
      expect(reserve[marker]).toBe('true');
      expect(reserve['aria-hidden']).toBe('true');
      expect(
        (reserve.children as { props: Record<string, unknown> }).props.className
      ).toBe(minHeight);
    }
  });

  it('holds product-section geometry while the home-product feed is pending', () => {
    // The slow-product-feed race: categories/launch resolve first while
    // products are still in flight. The product boundary must show its
    // median-grid reserve (not zero height) while discovery streams.
    mockProductSection.mockImplementationOnce(
      ({ productsPromise }: OgabasseyHomeProductSectionProps) => {
        use(productsPromise);
        return <section aria-label="Home products">/ogabassey</section>;
      }
    );

    const result = OgabasseyHomeDynamicContent({
      merchant: mockMerchant,
      pathPrefix: '/ogabassey',
    }) as ReactElement;

    render(result);

    const reserve = document.querySelector(
      '[data-ogabassey-product-reserve="true"]'
    );
    expect(reserve).not.toBeNull();
    expect(reserve?.querySelector('.min-h-\\[1200px\\]')).not.toBeNull();
    // Discovery streams ahead independently.
    expect(
      screen.getByRole('region', { name: 'Home discovery' })
    ).toBeInTheDocument();
  });

  it('holds discovery geometry while the enrichment legs are pending', () => {
    // The slow-category race: products resolve first while categories are
    // still in flight. The discovery boundary must show its median-card
    // reserve (not zero height) while the product grid streams.
    mockDiscoverySection.mockImplementationOnce(
      ({ categoriesPromise }: OgabasseyHomeDiscoverySectionProps) => {
        use(categoriesPromise);
        return <section aria-label="Home discovery">/ogabassey</section>;
      }
    );

    const result = OgabasseyHomeDynamicContent({
      merchant: mockMerchant,
      pathPrefix: '/ogabassey',
    }) as ReactElement;

    render(result);

    const reserve = document.querySelector(
      '[data-ogabassey-discovery-reserve="true"]'
    );
    expect(reserve).not.toBeNull();
    expect(reserve?.querySelector('.min-h-\\[280px\\]')).not.toBeNull();
    // The product grid streams ahead independently.
    expect(
      screen.getByRole('region', { name: 'Home products' })
    ).toBeInTheDocument();
  });

  it('renders merchant analytics without waiting for any fetch leg', () => {
    const result = OgabasseyHomeDynamicContent({
      merchant: mockMerchant,
      pathPrefix: '/ogabassey',
    }) as ReactElement;

    render(result);

    expect(
      screen.getByRole('status', { name: 'Merchant analytics' })
    ).toHaveTextContent('G-OGABASSEY');
    expect(
      screen.getByRole('region', { name: 'Home products' })
    ).toHaveTextContent('/ogabassey');
    expect(
      screen.getByRole('region', { name: 'Home discovery' })
    ).toHaveTextContent('/ogabassey');
  });

  it('falls back to normalized legacy analytics IDs when feature settings are blank', () => {
    // Top-level legacy IDs are intentionally absent from the static merchant
    // type (production reads them through an `unknown` record); asserting
    // back to the mock shape models exactly that: extra runtime fields the
    // type cannot see.
    const legacyMerchant = {
      ...mockMerchant,
      feature_settings: {
        ...mockMerchant.feature_settings,
        google_analytics_id: '   ',
      },
      google_analytics_id: ' G-LEGACY ',
      facebook_pixel_id: '   ',
    } as typeof mockMerchant;
    const result = OgabasseyHomeDynamicContent({
      merchant: legacyMerchant,
      pathPrefix: '/ogabassey',
    }) as ReactElement;

    render(result);

    const analytics = screen.getByRole('status', {
      name: 'Merchant analytics',
    });

    expect(analytics).toHaveTextContent('"google_analytics_id":"G-LEGACY"');
    expect(analytics).toHaveTextContent('"facebook_pixel_id":null');
  });
});
