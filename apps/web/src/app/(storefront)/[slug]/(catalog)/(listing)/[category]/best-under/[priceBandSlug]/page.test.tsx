import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockConnection,
  mockGetPriceBandStorefrontPathPrefix,
  mockPriceBandPageContent,
} = vi.hoisted(() => ({
  mockConnection: vi.fn<() => Promise<void>>(() => Promise.resolve()),
  mockGetPriceBandStorefrontPathPrefix: vi.fn(),
  mockPriceBandPageContent: vi.fn((_props: unknown) => (
    <div>Price band page content</div>
  )),
}));

const mockLoadPriceBandPage = vi.fn();
const mockNotFound = vi.fn(() => {
  throw new Error('NEXT_NOT_FOUND');
});

vi.mock('next/navigation', () => ({
  notFound: () => mockNotFound(),
}));

vi.mock('next/server', () => ({
  connection: () => mockConnection(),
}));

vi.mock('@/lib/seo-utils', () => ({
  getIndexableRobotsMetadata: () => ({
    index: true,
    follow: true,
    'max-image-preview': 'large',
    'max-snippet': -1,
    'max-video-preview': -1,
  }),
}));

vi.mock('@/lib/storefront-compare/load-price-band-page', () => ({
  getPriceBandStorefrontPathPrefix: (...args: unknown[]) =>
    mockGetPriceBandStorefrontPathPrefix(...args),
  loadPriceBandPage: (...args: unknown[]) => mockLoadPriceBandPage(...args),
}));

vi.mock('./price-band-page-content', () => ({
  PriceBandPageContent: (props: unknown) => mockPriceBandPageContent(props),
}));

const priceBandPageModel = {
  merchant: { business_name: 'Ogabassey' },
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
      name: 'Galaxy A56',
      category: 'Smartphones',
      category_slug: 'smartphones',
      price: 480_000,
      stock: 12,
      availability: 'InStock' as const,
      image: 'https://cdn.example.com/a56.jpg',
      description: 'Best midrange pick',
    },
  ],
  isIndexable: true,
  pathPrefix: '',
  payoutCurrency: 'NGN',
};

beforeEach(() => {
  mockConnection.mockReset();
  mockConnection.mockResolvedValue(undefined);
  mockGetPriceBandStorefrontPathPrefix.mockReset();
  mockGetPriceBandStorefrontPathPrefix.mockResolvedValue('');
  mockLoadPriceBandPage.mockReset();
  mockNotFound.mockClear();
  mockPriceBandPageContent.mockReset();
  mockPriceBandPageContent.mockImplementation(() => (
    <div>Price band page content</div>
  ));
  mockLoadPriceBandPage.mockResolvedValue(priceBandPageModel);
});

describe('price-band page metadata', () => {
  it('defers price-band first paint to the route loader while route params are pending', async () => {
    const { default: PriceBandPage } = await import('./page');
    mockConnection.mockImplementationOnce(
      () =>
        new Promise(() => {
          // Keep request-bound price-band work suspended behind the route shell.
        })
    );

    const page = PriceBandPage({
      params: Promise.resolve({
        slug: 'ogabassey',
        category: 'smartphones',
        priceBandSlug: 'under-500k',
      }),
    });
    expect(mockLoadPriceBandPage).not.toHaveBeenCalled();

    render(page);

    expect(
      screen.getByRole('status', { name: 'Loading product listing' })
    ).toBeInTheDocument();
    expect(
      screen.queryByText('Price band page content')
    ).not.toBeInTheDocument();
    expect(mockLoadPriceBandPage).not.toHaveBeenCalled();
    expect(mockPriceBandPageContent).not.toHaveBeenCalled();
  });

  it('emits canonical metadata for curated price-band pages', async () => {
    const { generateMetadata } = await import('./page');

    const metadata = await generateMetadata({
      params: Promise.resolve({
        slug: 'ogabassey',
        category: 'smartphones',
        priceBandSlug: 'under-500k',
      }),
    });

    expect(mockLoadPriceBandPage).toHaveBeenCalledWith(
      {
        merchantSlug: 'ogabassey',
        categorySlug: 'smartphones',
        priceBandSlug: 'under-500k',
      },
      {
        includeRequestPathPrefix: false,
      }
    );
    expect(metadata.title).toEqual({ absolute: priceBandPageModel.metaTitle });
    expect(metadata.description).toBe(priceBandPageModel.metaDescription);
    expect(metadata.openGraph).toMatchObject({
      title: priceBandPageModel.metaTitle,
      description: priceBandPageModel.metaDescription,
      url: priceBandPageModel.canonicalUrl,
      siteName: 'Ogabassey',
      images: ['https://cdn.example.com/a56.jpg'],
    });
    expect(metadata.twitter).toMatchObject({
      title: priceBandPageModel.metaTitle,
      description: priceBandPageModel.metaDescription,
      images: ['https://cdn.example.com/a56.jpg'],
    });
    expect(metadata.alternates?.canonical).toContain(
      '/smartphones/best-under/under-500k'
    );
    expect(metadata.robots).toEqual({
      index: true,
      follow: true,
      'max-image-preview': 'large',
      'max-snippet': -1,
      'max-video-preview': -1,
    });
  });

  it('calls notFound when the price-band loader returns null', async () => {
    mockLoadPriceBandPage.mockResolvedValueOnce(null);
    const { generateMetadata } = await import('./page');

    await expect(
      generateMetadata({
        params: Promise.resolve({
          slug: 'ogabassey',
          category: 'smartphones',
          priceBandSlug: 'under-500k',
        }),
      })
    ).rejects.toThrow('NEXT_NOT_FOUND');

    expect(mockNotFound).toHaveBeenCalledTimes(1);
  });

  it('calls notFound when the price-band page model is not indexable', async () => {
    mockLoadPriceBandPage.mockResolvedValueOnce({
      ...priceBandPageModel,
      isIndexable: false,
    });
    const { generateMetadata } = await import('./page');

    await expect(
      generateMetadata({
        params: Promise.resolve({
          slug: 'ogabassey',
          category: 'smartphones',
          priceBandSlug: 'under-500k',
        }),
      })
    ).rejects.toThrow('NEXT_NOT_FOUND');

    expect(mockNotFound).toHaveBeenCalledTimes(1);
  });

  it('rejects when loadPriceBandPage throws a database error', async () => {
    mockLoadPriceBandPage.mockRejectedValueOnce(
      new Error('Price band inventory is temporarily unavailable')
    );
    const { generateMetadata } = await import('./page');

    await expect(
      generateMetadata({
        params: Promise.resolve({
          slug: 'ogabassey',
          category: 'smartphones',
          priceBandSlug: 'under-500k',
        }),
      })
    ).rejects.toThrow('Price band inventory is temporarily unavailable');

    expect(mockNotFound).not.toHaveBeenCalled();
  });
});
