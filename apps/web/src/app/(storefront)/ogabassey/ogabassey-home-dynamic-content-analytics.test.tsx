import { render, screen } from '@testing-library/react';
import type { ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';

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

describe('OgabasseyHomeDynamicContent analytics', () => {
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
