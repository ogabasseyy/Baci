import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Product } from '@/lib/products';

const mockOgabasseyHomePage = vi.fn(
  ({
    storeSlug,
    products,
  }: {
    storeSlug?: string;
    products?: unknown[];
  }) => (
    <article aria-label={`${storeSlug}:${products?.length ?? 0}`}>
      {storeSlug}:{products?.length ?? 0}
    </article>
  )
);
const mockCreateOgabasseyHomeProductFeed = vi.fn((products: unknown[]) =>
  products.slice(0, 1).map((product, index) => ({
    product,
    compact: true,
    index,
  }))
);

vi.mock('@/components/storefront/ogabassey/pages/home', () => ({
  OgabasseyHomePage: (props: { storeSlug?: string; products?: unknown[] }) =>
    mockOgabasseyHomePage(props),
}));

vi.mock('@/components/storefront/ogabassey/home-product-feed', () => ({
  createOgabasseyHomeProductFeed: (products: unknown[]) =>
    mockCreateOgabasseyHomeProductFeed(products),
}));

vi.mock('@/components/storefront/ogabassey/pages/about-us', () => ({
  OgabasseyV2AboutUs: () => null,
}));
vi.mock('@/components/storefront/ogabassey/pages/privacy-policy', () => ({
  OgabasseyV2PrivacyPolicy: () => null,
}));
vi.mock('@/components/storefront/ogabassey/pages/legal-dispute', () => ({
  OgabasseyV2LegalDispute: () => null,
}));
vi.mock('@/components/storefront/ogabassey/pages/sustainability', () => ({
  OgabasseyV2Sustainability: () => null,
}));
vi.mock('@/components/storefront/ogabassey/pages/repairs', () => ({
  OgabasseyV2Repairs: () => null,
}));
vi.mock('@/components/storefront/ogabassey/pages/swap', () => ({
  OgabasseyV2Swap: () => null,
}));
vi.mock('@/components/storefront/ogabassey/pages/help-support', () => ({
  OgabasseyV2HelpSupport: () => null,
}));
vi.mock('@/components/storefront/ogabassey/pages/blog', () => ({
  OgabasseyV2Blog: () => null,
}));

import { getTemplate } from './registry';

describe('template registry', () => {
  beforeEach(() => {
    mockOgabasseyHomePage.mockClear();
    mockCreateOgabasseyHomeProductFeed.mockClear();
  });

  it('loads Ogabassey components without exposing an unused layout wrapper', async () => {
    const template = getTemplate('ogabassey');

    expect(template).toBeDefined();

    const components = await template!.getComponents();

    expect(components.Home).toBeDefined();
    expect(components.Layout).toBeUndefined();
  });

  it('preserves the store slug when rendering the Ogabassey home wrapper', async () => {
    const template = getTemplate('ogabassey');
    expect(template).toBeDefined();
    const components = await template!.getComponents();

    render(<components.Home storeSlug="ogabassey" products={[]} />);

    expect(
      screen.getByRole('article', { name: 'ogabassey:0' })
    ).toHaveTextContent('ogabassey:0');
  });

  it('adapts Ogabassey home products through the compact homepage feed', async () => {
    const template = getTemplate('ogabassey');
    expect(template).toBeDefined();
    const components = await template!.getComponents();
    const products = [
      {
        id: 'product-1',
        name: 'Product 1',
        description: 'Product 1 description',
        status: 'active',
        price: 1000,
        manage_stock: false,
        stock: 3,
        image: '/product-1.jpg',
        imageLarge: '/large-1.jpg',
        imageHint: 'Product 1',
        brand: 'OgaBassey',
        gtin: '',
        mpn: '',
      },
      {
        id: 'product-2',
        name: 'Product 2',
        description: 'Product 2 description',
        status: 'active',
        price: 2000,
        manage_stock: false,
        stock: 2,
        image: '/product-2.jpg',
        imageLarge: '/large-2.jpg',
        imageHint: 'Product 2',
        brand: 'OgaBassey',
        gtin: '',
        mpn: '',
      },
    ] satisfies Product[];

    render(<components.Home storeSlug="ogabassey" products={products} />);

    expect(mockCreateOgabasseyHomeProductFeed).toHaveBeenCalledWith(products);
    expect(mockOgabasseyHomePage).toHaveBeenCalledWith(
      expect.objectContaining({
        products: [
          expect.objectContaining({
            compact: true,
            product: products[0],
          }),
        ],
      })
    );
  });

  it('keeps optional info pages out of the registry bundle', async () => {
    // The info pages are imported directly, each only by the route that
    // renders it. If they ever return to getComponents, they rejoin every
    // route's initial JS — including the homepage.
    const template = getTemplate('ogabassey');
    expect(template).toBeDefined();
    const components = await template!.getComponents();

    expect(Object.keys(components).sort()).toEqual(['Home']);
  });
});
