import { render, screen } from '@testing-library/react';
import type { ReactElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getCachedStorefrontHomeProducts,
  getCachedStorefrontLaunchProducts,
} from '@/lib/cached-data';
import { getCachedStorefrontProductsBySlugs } from '@/lib/cached-storefront-products-by-slugs';

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

vi.mock('@/lib/cached-storefront-products-by-slugs', () => ({
  getCachedStorefrontProductsBySlugs: vi.fn(() => Promise.resolve([])),
}));

vi.mock('next/link', () => ({
  default: ({
    children,
    href,
    prefetch: _prefetch,
    ...props
  }: React.AnchorHTMLAttributes<HTMLAnchorElement> & {
    href: string;
    prefetch?: boolean;
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

import { OgabasseyHomeDiscoverySection } from './ogabassey-home-discovery-section';
import { loadOgabasseyLaunchProducts } from './ogabassey-home-launch-products';

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

function createCategories() {
  return [{ name: 'Smartphones', slug: 'smartphones' }];
}

describe('OgabasseyHomeDiscoverySection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getCachedStorefrontHomeProducts).mockResolvedValue([]);
    vi.mocked(getCachedStorefrontLaunchProducts).mockResolvedValue([]);
    vi.mocked(getCachedStorefrontProductsBySlugs).mockResolvedValue([]);
  });

  function renderDiscovery({
    merchant = mockMerchant,
    pathPrefix = '/ogabassey',
    products = [] as StorefrontHomeProduct[],
    categories = createCategories(),
    launchProductsPromise = loadOgabasseyLaunchProducts('merchant-1'),
  }: {
    merchant?: typeof mockMerchant;
    pathPrefix?: string;
    products?: StorefrontHomeProduct[];
    categories?: { name: string; slug: string }[];
    launchProductsPromise?: ReturnType<typeof loadOgabasseyLaunchProducts>;
  }) {
    return OgabasseyHomeDiscoverySection({
      categoriesPromise: Promise.resolve(categories),
      launchProductsPromise,
      merchant,
      pathPrefix,
      productsPromise: Promise.resolve(products),
    });
  }

  it('renders category discovery links with the route prefix', async () => {
    const result = await renderDiscovery({});

    render(result as ReactElement);

    expect(screen.getByRole('link', { name: 'Smartphones' })).toHaveAttribute(
      'href',
      '/ogabassey/smartphones'
    );
  });

  it('keeps discovery links for products whose slugs are generated from names', async () => {
    const result = await renderDiscovery({
      products: [
        createProduct({
          id: 'product-slugless',
          name: 'Galaxy Fold 8',
          slug: '',
        }),
      ],
    });

    render(result as ReactElement);

    expect(screen.getByRole('link', { name: 'Galaxy Fold 8' })).toHaveAttribute(
      'href',
      '/ogabassey/smartphones/galaxy-fold-8'
    );
  });

  it('emits raw parsable JSON-LD scripts', async () => {
    const result = await renderDiscovery({
      products: [createProduct()],
    });

    const { container } = render(result as ReactElement);
    const scripts = container.querySelectorAll(
      'script[type="application/ld+json"]'
    );

    expect(scripts).toHaveLength(1);
    for (const script of scripts) {
      expect(script.innerHTML).not.toContain('&amp;');
      expect(() => JSON.parse(script.innerHTML || '')).not.toThrow();
    }

    const schema = JSON.parse(scripts[0]?.innerHTML || '{}') as {
      '@graph': Record<string, unknown>[];
    };

    expect(schema['@graph']).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          '@id': 'https://ogabassey.com/#online-store',
          '@type': 'OnlineStore',
        }),
        expect.objectContaining({
          '@id': 'https://ogabassey.com/#homepage',
          '@type': 'CollectionPage',
          mainEntity: expect.objectContaining({
            '@id': 'https://ogabassey.com/#featured-products',
            '@type': 'ItemList',
          }),
        }),
        expect.objectContaining({
          '@id': 'https://ogabassey.com/#category-hubs',
          '@type': 'ItemList',
        }),
        expect.objectContaining({
          '@id': 'https://ogabassey.com/#site-navigation',
          '@type': 'SiteNavigationElement',
        }),
      ])
    );
  });

  it('prepends targeted pinned launch products into the home ItemList even when they fall outside the recent window', async () => {
    // Recent window: 8 products, none of them the pinned launch device.
    const windowProducts = Array.from({ length: 8 }, (_, index) =>
      createProduct({
        id: `recent-${index}`,
        name: `Recent ${index}`,
        slug: `recent-${index}`,
      })
    );
    // The targeted by-slug fetch returns the pin that is absent from the window.
    // A real pinned product carries an image, so it survives the renderable
    // filter and is prepended into the launch set + schema.
    vi.mocked(getCachedStorefrontProductsBySlugs).mockResolvedValue([
      createProduct({
        id: 'a27',
        name: 'Samsung Galaxy A27 5G Preorder',
        slug: 'samsung-galaxy-a27-5g',
        category: 'Smartphones',
        images: ['https://cdn.ogabassey.com/products/a27.avif'],
      }),
    ]);

    const result = await renderDiscovery({ products: windowProducts });

    const { container } = render(result as ReactElement);
    const script = container.querySelector(
      'script[type="application/ld+json"]'
    );
    const json = script?.innerHTML || '{}';

    // The pin made it into the schema even though it was never in the recent
    // window — proof the deterministic pinned fetch is wired into the ItemList.
    expect(json).toContain('samsung-galaxy-a27-5g');

    const schema = JSON.parse(json) as { '@graph': Record<string, unknown>[] };
    const collectionPage = schema['@graph'].find(
      (node) => node['@type'] === 'CollectionPage'
    ) as { mainEntity?: { itemListElement?: unknown[] } } | undefined;
    const elements = collectionPage?.mainEntity?.itemListElement ?? [];
    // Pinned-first: the A27 leads the featured-products ItemList.
    expect(JSON.stringify(elements[0])).toContain('samsung-galaxy-a27-5g');
  });

  it('emits OutOfStock for a managed, sold-out launch product (inventory survives the dedupe)', async () => {
    // The same out-of-stock product is both a launch pin (display-shaped, no
    // inventory) and in the recent window (template-shaped, has inventory). The
    // launch copy wins the slug dedupe, so without restoring inventory the schema
    // would wrongly emit InStock.
    const soldOut = createProduct({
      id: 'a27',
      name: 'Samsung Galaxy A27 5G',
      slug: 'samsung-galaxy-a27-5g',
      category: 'Smartphones',
      images: ['https://cdn.ogabassey.com/products/a27.avif'],
      manage_stock: true,
      stock_quantity: 0,
      stock: 0,
    });
    vi.mocked(getCachedStorefrontProductsBySlugs).mockResolvedValue([soldOut]);

    const result = await renderDiscovery({ products: [soldOut] });

    const { container } = render(result as ReactElement);
    const json =
      container.querySelector('script[type="application/ld+json"]')
        ?.innerHTML || '{}';
    const schema = JSON.parse(json) as { '@graph': Record<string, unknown>[] };
    const collectionPage = schema['@graph'].find(
      (node) => node['@type'] === 'CollectionPage'
    ) as { mainEntity?: { itemListElement?: unknown[] } } | undefined;
    const element = (collectionPage?.mainEntity?.itemListElement ?? []).find(
      (node) => JSON.stringify(node).includes('samsung-galaxy-a27-5g')
    );

    expect(JSON.stringify(element)).toContain('OutOfStock');
    expect(JSON.stringify(element)).not.toContain('InStock');
  });

  it('includes the blog hub in the semantic graph only when the visible blog link is enabled', async () => {
    const result = await renderDiscovery({
      merchant: {
        ...mockMerchant,
        feature_settings: {
          ...mockMerchant.feature_settings,
          blog_enabled: true,
        },
      },
      pathPrefix: '',
      products: [createProduct()],
    });

    const { container } = render(result as ReactElement);
    const schemaScript = container.querySelector(
      'script[type="application/ld+json"]'
    );
    const schema = JSON.parse(schemaScript?.innerHTML || '{}') as {
      '@graph': Record<string, unknown>[];
    };

    expect(screen.getByRole('link', { name: 'Blog' })).toHaveAttribute(
      'href',
      '/blog'
    );
    expect(schema['@graph']).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          '@id': 'https://ogabassey.com/blog#blog',
          '@type': 'Blog',
        }),
      ])
    );
  });

  it('degrades to grid-only schema coverage when the launch feed fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.mocked(getCachedStorefrontLaunchProducts).mockRejectedValue(
      new Error('launch feed down')
    );

    const result = await renderDiscovery({
      products: [createProduct()],
    });

    const { container } = render(result as ReactElement);

    // The launch products are JSON-LD-only; a feed failure must not take down
    // the discovery section — the recent-window product still schemas.
    expect(
      screen.getByRole('link', { name: 'iPhone 17 Pro Max' })
    ).toHaveAttribute('href', '/ogabassey/smartphones/iphone-17-pro-max');
    const json =
      container.querySelector('script[type="application/ld+json"]')
        ?.innerHTML || '{}';
    expect(json).toContain('iphone-17-pro-max');
  });
});
