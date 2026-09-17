import { render, screen } from '@testing-library/react';
import type { ReactElement } from 'react';
import { Suspense } from 'react';
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

vi.mock('./ogabassey-home-dynamic-sections', () => ({
  OgabasseyHomeDiscoverySection: (props: OgabasseyHomeDiscoverySectionProps) =>
    mockDiscoverySection(props),
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

import { OgabasseyHomeDynamicContent } from './ogabassey-home-dynamic-content';
import type {
  OgabasseyHomeDiscoverySectionProps,
  OgabasseyHomeProductSectionProps,
} from './ogabassey-home-dynamic-sections';

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

  it('isolates each half in its own null-fallback Suspense boundary', () => {
    // No `as ReactElement`: the inferred element type keeps `.props`
    // accessible for tree inspection (the imported ReactElement type does
    // not expose it under this repo's React 19 types).
    const result = OgabasseyHomeDynamicContent({
      merchant: mockMerchant,
      pathPrefix: '/ogabassey',
    });

    // Structural probe: the only contract is two Suspense boundaries with
    // null fallbacks, so type the tree minimally instead of fighting the
    // ReactElement generic.
    const children = (
      Array.isArray(result.props.children)
        ? result.props.children
        : [result.props.children]
    ) as Array<{ type?: unknown; props?: { fallback?: unknown } }>;
    const boundaries = children.filter((child) => child?.type === Suspense);
    expect(boundaries).toHaveLength(2);
    for (const boundary of boundaries) {
      expect(boundary.props?.fallback).toBeNull();
    }
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
