import { render, screen } from '@testing-library/react';
import type { ReactElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getCachedStorefrontHomeProducts,
  getCachedStorefrontLaunchProducts,
} from '@/lib/cached-data';

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
    // Real settings field (blog hub gating); default off so tests that omit
    // it keep asserting the no-blog baseline.
    blog_enabled: false,
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

vi.mock('@/lib/cached-data', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    getCachedStorefrontHomeProducts: vi.fn(() => Promise.resolve([])),
    getCachedStorefrontLaunchProducts: vi.fn(() => Promise.resolve([])),
  };
});

vi.mock('@/components/storefront/ogabassey/pages/home', () => ({
  OgabasseyHomePage: ({
    basePath,
    launchProducts,
    products,
    renderHero,
    storeSlug,
  }: {
    basePath?: string;
    launchProducts?: unknown[];
    products?: unknown[];
    renderHero?: boolean;
    storeSlug?: string;
  }) => (
    <section aria-label="OgaBassey home payload">
      {storeSlug}:{basePath}:{products?.length ?? 0}:
      {launchProducts?.length ?? 0}:{String(renderHero)}
    </section>
  ),
}));

vi.mock('@/components/storefront/ogabassey/home-product-feed', () => ({
  createOgabasseyHomeProductFeed: vi.fn((products: unknown[]) =>
    products.slice(0, 1)
  ),
  mapStorefrontProductsToOgabasseyProducts: vi.fn(
    (products: unknown[]) => products
  ),
}));

import { createOgabasseyHomeProductFeed } from '@/components/storefront/ogabassey/home-product-feed';
import { loadOgabasseyLaunchProducts } from './ogabassey-home-launch-products';
import { OgabasseyHomeProductSection } from './ogabassey-home-product-section';

type StorefrontHomeProduct = Awaited<
  ReturnType<typeof getCachedStorefrontHomeProducts>
>[number];

function createProduct(
  overrides: Partial<StorefrontHomeProduct> = {}
): StorefrontHomeProduct {
  return {
    id: 'product-1',
    name: 'iPhone 17 Pro Max',
    slug: 'iphone-17-pro-max',
    description: 'Apple flagship phone.',
    price: 2500000,
    compare_at_price: null,
    images: [
      'https://cdn.ogabassey.com/core-assets/products/iphone-17-pro-max.avif',
    ],
    category: 'Smartphones',
    brand: 'Apple',
    condition: 'new',
    stock: 4,
    stock_quantity: null,
    manage_stock: false,
    low_stock_threshold: null,
    product_categories: [],
    ...overrides,
  };
}

describe('OgabasseyHomeProductSection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getCachedStorefrontHomeProducts).mockResolvedValue([]);
    vi.mocked(getCachedStorefrontLaunchProducts).mockResolvedValue([]);
  });

  it('renders the product grid from the home-product feed without the hero', async () => {
    const result = await OgabasseyHomeProductSection({
      merchant: mockMerchant,
      pathPrefix: '/ogabassey',
      productsPromise: Promise.resolve([createProduct()]),
    });

    render(result as ReactElement);

    // The launch leg is intentionally absent here: with renderHero={false}
    // the grid ignores launch slides (the Hero owns them in its own
    // streamed boundary), so the grid streams on the product feed alone.
    expect(
      screen.getByRole('region', { name: 'OgaBassey home payload' })
    ).toHaveTextContent('ogabassey:/ogabassey:1:0:false');
    expect(createOgabasseyHomeProductFeed).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ id: 'product-1' })]),
      expect.objectContaining({ code: 'NGN' })
    );
  });

  it('passes the resolved merchant currency to the OgaBassey home product feed', async () => {
    const result = await OgabasseyHomeProductSection({
      merchant: { ...mockMerchant, payout_currency: 'INR', country: 'IN' },
      pathPrefix: '/ogabassey',
      productsPromise: Promise.resolve([createProduct()]),
    });

    render(result as ReactElement);

    expect(createOgabasseyHomeProductFeed).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({ code: 'INR', symbol: '₹' })
    );
  });

  it('still renders the grid when the launch feed fails', async () => {
    // The launch leg rejects in the background while the grid awaits only
    // the product feed: a launch outage must not take down visible products.
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.mocked(getCachedStorefrontLaunchProducts).mockRejectedValue(
      new Error('launch feed down')
    );
    const launchPromise = loadOgabasseyLaunchProducts('merchant-1');

    const result = await OgabasseyHomeProductSection({
      merchant: mockMerchant,
      pathPrefix: '/ogabassey',
      productsPromise: Promise.resolve([createProduct()]),
    });

    render(result as ReactElement);

    expect(
      screen.getByRole('region', { name: 'OgaBassey home payload' })
    ).toBeInTheDocument();
    // Best-effort loader degrades to empty launch coverage on its own.
    await expect(launchPromise).resolves.toEqual([]);
  });
});
