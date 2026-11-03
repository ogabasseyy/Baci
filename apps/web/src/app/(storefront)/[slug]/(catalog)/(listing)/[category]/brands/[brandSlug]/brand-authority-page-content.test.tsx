import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { BrandAuthorityPageContentModel } from './brand-authority-page-content';

vi.mock(
  '@/app/(storefront)/[slug]/(catalog)/(listing)/products/product-index-card',
  () => ({
    ProductIndexCard: ({ product }: { product: { name: string } }) => (
      <div>{product.name}</div>
    ),
  })
);
vi.mock('@/lib/resolve-merchant-currency', () => ({
  resolveMerchantCurrencyConfig: () => ({ code: 'NGN' }),
}));
vi.mock('@/lib/sanitize-json-ld', () => ({
  safeJsonLdStringify: (value: unknown) => JSON.stringify(value),
}));

const page = {
  canonicalUrl: 'https://ogabassey.com/smartphones/brands/samsung',
  heading: 'Samsung Phones and Prices in Nigeria',
  intro: 'Compare six active Samsung phones.',
  categoryName: 'Smartphones',
  categoryUrl: 'https://ogabassey.com/smartphones',
  brand: { displayName: 'Samsung' },
  merchant: { country: 'NG', payout_currency: 'NGN' },
  breadcrumbItems: [
    { name: 'Ogabassey', url: 'https://ogabassey.com' },
    { name: 'Smartphones', url: 'https://ogabassey.com/smartphones' },
    {
      name: 'Samsung',
      url: 'https://ogabassey.com/smartphones/brands/samsung',
    },
  ],
  pathPrefix: '',
  familyLinks: [
    {
      href: 'https://ogabassey.com/smartphones/brands/samsung/families/galaxy-a',
      label: 'Samsung Galaxy A phones',
      productCount: 10,
    },
  ],
  products: [
    {
      id: 'product-1',
      name: 'Samsung Galaxy A56',
      slug: 'samsung-galaxy-a56',
      description: 'Galaxy phone',
      image: 'https://cdn.example.com/a56.jpg',
      category: 'Smartphones',
      category_slug: 'smartphones',
      brand: 'Samsung',
      price: 450_000,
      condition: 'new',
      stock: 4,
      availability: 'InStock' as const,
      has_condition_offers: false,
    },
  ],
  guideLinks: [
    {
      href: 'https://ogabassey.com/blog/best-samsung-phones',
      title: 'Best Samsung Phones',
      description: 'Compare Galaxy models.',
      kind: 'buyer-guide' as const,
    },
  ],
} satisfies BrandAuthorityPageContentModel;

describe('BrandAuthorityPageContent', () => {
  it('renders brand context, product links, category link, and guides', async () => {
    const { BrandAuthorityPageContent } = await import(
      './brand-authority-page-content'
    );
    const { container } = render(<BrandAuthorityPageContent page={page} />);

    expect(
      screen.getByRole('heading', {
        level: 1,
        name: 'Samsung Phones and Prices in Nigeria',
      })
    ).toBeInTheDocument();
    expect(screen.getByText('Samsung Galaxy A56')).toBeInTheDocument();
    expect(
      screen.getByText('Compare six active Samsung phones.')
    ).toHaveAttribute('data-cwv-lcp-copy', 'authority-hub');
    expect(
      screen.getByRole('link', { name: 'Browse all smartphones' })
    ).toHaveAttribute('href', 'https://ogabassey.com/smartphones');
    expect(
      screen.getByRole('link', { name: 'Best Samsung Phones' })
    ).toHaveAttribute('href', 'https://ogabassey.com/blog/best-samsung-phones');
    expect(
      screen.getByRole('link', { name: 'Samsung Galaxy A phones (10)' })
    ).toHaveAttribute(
      'href',
      'https://ogabassey.com/smartphones/brands/samsung/families/galaxy-a'
    );

    const schemas = Array.from(
      container.querySelectorAll('script[type="application/ld+json"]')
    ).map((script) => JSON.parse(script.textContent ?? '{}'));
    expect(schemas).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ '@type': 'BreadcrumbList' }),
        expect.objectContaining({
          '@type': 'ItemList',
          itemListElement: [
            expect.objectContaining({
              position: 1,
              item: expect.objectContaining({
                '@type': 'Product',
                name: 'Samsung Galaxy A56',
              }),
            }),
          ],
        }),
      ])
    );
  });

  it('renders accessible empty inventory copy without a guides section', async () => {
    const { BrandAuthorityPageContent } = await import(
      './brand-authority-page-content'
    );
    render(
      <BrandAuthorityPageContent
        page={{ ...page, guideLinks: [], products: [] }}
      />
    );

    expect(
      screen.getByText('No Samsung models are currently available.')
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: 'Samsung buying guides' })
    ).not.toBeInTheDocument();
  });

  it('omits model family navigation when no families qualify', async () => {
    const { BrandAuthorityPageContent } = await import(
      './brand-authority-page-content'
    );
    render(
      <BrandAuthorityPageContent page={{ ...page, familyLinks: undefined }} />
    );

    expect(
      screen.queryByRole('heading', { name: 'Shop by model family' })
    ).not.toBeInTheDocument();
  });
});
