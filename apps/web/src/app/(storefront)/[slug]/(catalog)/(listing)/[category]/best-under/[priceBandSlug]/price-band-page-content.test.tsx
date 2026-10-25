import { render, screen } from '@testing-library/react';
import type { ReactElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockLoadPriceBandPage = vi.fn();
const mockNotFound = vi.fn(() => {
  throw new Error('NEXT_NOT_FOUND');
});

vi.mock('next/navigation', () => ({
  notFound: () => mockNotFound(),
}));

vi.mock('@/lib/storefront-compare/load-price-band-page', () => ({
  loadPriceBandPage: (...args: unknown[]) => mockLoadPriceBandPage(...args),
}));

vi.mock('@/lib/sanitize-json-ld', () => ({
  safeJsonLdStringify: (value: unknown) => JSON.stringify(value),
}));

const priceBandPageModel = {
  canonicalUrl: 'https://ogabassey.com/smartphones/best-under/under-500k',
  metaTitle: 'Best Smartphones Under ₦500,000 | Ogabassey',
  metaDescription:
    'Compare the best smartphones under ₦500,000 from Ogabassey.',
  heading: 'Best Smartphones Under ₦500,000',
  intro:
    'These are the strongest smartphone options below the ₦500,000 price band.',
  breadcrumbItems: [
    { name: 'Ogabassey', url: 'https://ogabassey.com' },
    { name: 'Smartphones', url: 'https://ogabassey.com/smartphones' },
    {
      name: 'Best Smartphones Under ₦500,000',
      url: 'https://ogabassey.com/smartphones/best-under/under-500k',
    },
  ],
  products: [
    {
      id: 'product-c',
      slug: 'galaxy-a56',
      name: 'Galaxy A56 - 128GB - Refurbished',
      variantId: 'variant-a56',
      availabilityLabel: 'In stock',
      category: 'Smartphones',
      category_slug: 'smartphones',
      brand: 'Samsung',
      price: 480_000,
      stock: 12,
      availability: 'InStock' as const,
      image: 'https://cdn.example.com/a56.jpg',
      description: 'Best midrange pick',
      condition: 'Refurbished',
      has_condition_offers: false,
    },
    {
      id: 'product-d',
      slug: 'iphone-16e',
      name: 'iPhone 16e',
      availabilityLabel: 'Available to order — confirm fulfillment',
      category: 'Smartphones',
      category_slug: 'smartphones',
      brand: 'Apple',
      price: 495_000,
      stock: 4,
      availability: 'InStock' as const,
      image: 'https://cdn.example.com/16e.jpg',
      description: 'Flexible condition availability',
      condition: 'New',
      has_condition_offers: true,
    },
  ],
  guideLinks: [
    {
      href: 'https://ogabassey.com/blog/best-phones-in-nigeria',
      title: 'Best Phones in Nigeria',
      description: 'Budget and flagship picks.',
      kind: 'best-in-nigeria' as const,
    },
  ],
  isIndexable: true,
  pathPrefix: '',
  payoutCurrency: 'NGN',
};

describe('PriceBandPageContent', () => {
  beforeEach(() => {
    mockLoadPriceBandPage.mockReset();
    mockNotFound.mockClear();
    mockLoadPriceBandPage.mockResolvedValue(priceBandPageModel);
  });

  it('renders the heading, intro, and product cards', async () => {
    const { PriceBandPageContent } = await import('./price-band-page-content');

    render(
      (await PriceBandPageContent({
        params: Promise.resolve({
          slug: 'ogabassey',
          category: 'smartphones',
          priceBandSlug: 'under-500k',
        }),
      })) as ReactElement
    );

    expect(
      screen.getByRole('heading', {
        name: /Best Smartphones Under ₦500,000/i,
      })
    ).toBeInTheDocument();
    expect(
      screen.getByText(/These are the strongest smartphone options/i)
    ).toBeInTheDocument();
    expect(
      screen.getByText('Galaxy A56 - 128GB - Refurbished')
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Galaxy A56/ })).toHaveAttribute(
      'href',
      'https://ogabassey.com/smartphones/galaxy-a56?variantId=variant-a56'
    );
    expect(screen.getByText('In stock')).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'How to use this budget comparison' })
    ).toBeInTheDocument();
    expect(screen.getByText('Condition: Refurbished')).toBeInTheDocument();

    expect(
      screen.getByRole('link', { name: 'Best Phones in Nigeria' })
    ).toHaveAttribute(
      'href',
      'https://ogabassey.com/blog/best-phones-in-nigeria'
    );
  });

  it('renders breadcrumb and ItemList schema scripts', async () => {
    const { PriceBandPageContent } = await import('./price-band-page-content');

    const { container } = render(
      (await PriceBandPageContent({
        params: Promise.resolve({
          slug: 'ogabassey',
          category: 'smartphones',
          priceBandSlug: 'under-500k',
        }),
      })) as ReactElement
    );

    const schemaScripts = container.querySelectorAll(
      'script[type="application/ld+json"]'
    );

    expect(schemaScripts).toHaveLength(2);
    expect(schemaScripts[0]?.textContent).toContain('"@type":"BreadcrumbList"');
    expect(schemaScripts[1]?.textContent).toContain('"@type":"ItemList"');
    expect(schemaScripts[1]?.textContent).toContain('variantId=variant-a56');
    expect(schemaScripts[1]?.textContent).toContain(
      'https://schema.org/RefurbishedCondition'
    );
  });

  it('calls notFound when the price-band loader returns a non-indexable page', async () => {
    mockLoadPriceBandPage.mockResolvedValueOnce({
      ...priceBandPageModel,
      isIndexable: false,
    });
    const { PriceBandPageContent } = await import('./price-band-page-content');

    await expect(
      PriceBandPageContent({
        params: Promise.resolve({
          slug: 'ogabassey',
          category: 'smartphones',
          priceBandSlug: 'under-500k',
        }),
      })
    ).rejects.toThrow('NEXT_NOT_FOUND');

    expect(mockNotFound).toHaveBeenCalledTimes(1);
  });

  it('renders product prices with the page payout currency', async () => {
    mockLoadPriceBandPage.mockResolvedValueOnce({
      ...priceBandPageModel,
      payoutCurrency: 'INR',
      products: [
        {
          ...priceBandPageModel.products[0],
          price: 2500,
        },
      ],
    });
    const { PriceBandPageContent } = await import('./price-band-page-content');

    render(
      (await PriceBandPageContent({
        params: Promise.resolve({
          slug: 'yodha',
          category: 'fashion',
          priceBandSlug: 'under-5k',
        }),
      })) as ReactElement
    );

    expect(screen.getByText(/₹2,500|INR/)).toBeInTheDocument();
    expect(screen.queryByText('₦2,500')).not.toBeInTheDocument();
  });
});
