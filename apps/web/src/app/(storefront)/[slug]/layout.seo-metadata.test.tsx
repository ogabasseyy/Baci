import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockMerchant = vi.fn();

vi.mock('@/lib/cached-data', () => ({
  getRequestScopedMerchant: (...args: unknown[]) => mockMerchant(...args),
}));
vi.mock('@/lib/store-url', () => ({
  buildStoreUrl: (merchant: { slug: string; custom_domain?: string | null }) =>
    merchant.custom_domain
      ? `https://${merchant.custom_domain}`
      : `https://${merchant.slug}.usebaci.com`,
}));
vi.mock('@/lib/validation', () => ({ isValidMerchantIdentifier: () => true }));
vi.mock('@/lib/storefront-smart-app-banner-metadata', () => ({
  mergeStorefrontSmartAppBannerOther: () => null,
}));

const { generateMetadata } = await import('./layout');

describe('storefront layout SEO metadata', () => {
  beforeEach(() => mockMerchant.mockReset());

  it('uses factual fallback description and a merchant-branded title template', async () => {
    mockMerchant.mockResolvedValue({
      slug: 'foodflow',
      business_name: 'Foodflow',
      business_type: 'food-beverage',
      custom_domain: null,
      site_title: null,
      site_description: null,
      site_tagline: null,
      country: 'NG',
      logo_url: null,
      feature_settings: {},
      published_config: null,
    });

    const metadata = await generateMetadata({
      params: Promise.resolve({ slug: 'foodflow' }),
    });

    expect(metadata.title).toEqual({
      default: 'Foodflow',
      template: '%s | Foodflow',
    });
    expect(metadata.description).toBe('Foodflow storefront in NG.');
  });

  it('preserves an authored Open Graph title', async () => {
    mockMerchant.mockResolvedValue({
      slug: 'medplus',
      business_name: 'Medplus',
      custom_domain: null,
      site_title: 'Medplus | Buy Gadgets Pay Later',
      site_description: null,
      site_tagline: null,
      country: 'NG',
      logo_url: null,
      feature_settings: {},
      published_config: null,
    });

    const metadata = await generateMetadata({
      params: Promise.resolve({ slug: 'medplus' }),
    });

    expect(metadata.title).toEqual({
      default: 'Medplus | Buy Gadgets Pay Later',
      template: '%s | Medplus',
    });
    expect(metadata.openGraph?.title).toBe('Medplus | Buy Gadgets Pay Later');
    expect(metadata.description).toBe('Medplus storefront in NG.');
  });
});
