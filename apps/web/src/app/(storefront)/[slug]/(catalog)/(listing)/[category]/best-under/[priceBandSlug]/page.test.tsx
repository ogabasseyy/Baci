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

vi.mock('@/app/(storefront)/[slug]/storefront-route-not-found-content', () => ({
  StorefrontRouteNotFoundContent: ({
    title,
    message,
    backHref,
  }: {
    title: string;
    message: string;
    backHref: string;
  }) => (
    <div>
      <h1>{title}</h1>
      <p>{message}</p>
      <a href={backHref}>Back</a>
    </div>
  ),
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
  merchant: {
    slug: 'ogabassey',
    business_name: 'Ogabassey',
  },
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

  it('returns marker-free not-found metadata and renders fallback when loader returns null', async () => {
    mockLoadPriceBandPage.mockResolvedValueOnce(null);
    const { PriceBandPageRuntime, generateMetadata } = await import('./page');

    const metadata = await generateMetadata({
      params: Promise.resolve({
        slug: 'ogabassey',
        category: 'smartphones',
        priceBandSlug: 'under-500k',
      }),
    });

    expect(metadata).toEqual({
      title: 'Price Band Guide Not Found',
      description: 'This price band guide is unavailable.',
      robots: { index: false, follow: true },
      alternates: null,
      openGraph: undefined,
      twitter: undefined,
    });

    mockLoadPriceBandPage.mockResolvedValueOnce(null);
    mockGetPriceBandStorefrontPathPrefix.mockResolvedValueOnce('/ogabassey');
    const ui = await PriceBandPageRuntime({
      params: Promise.resolve({
        slug: 'ogabassey',
        category: 'smartphones',
        priceBandSlug: 'under-500k',
      }),
    });
    render(ui);

    expect(
      screen.getByRole('heading', { name: 'Price band guide not found' })
    ).toBeInTheDocument();
    expect(
      screen.getByText('This price band guide is unavailable or has moved.')
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back' })).toHaveAttribute(
      'href',
      '/ogabassey'
    );
  });

  it('returns marker-free not-found metadata and renders fallback with root backHref on a merchant subdomain when price-band is not indexable', async () => {
    mockLoadPriceBandPage.mockResolvedValueOnce({
      ...priceBandPageModel,
      isIndexable: false,
    });
    const { PriceBandPageRuntime, generateMetadata } = await import('./page');

    const metadata = await generateMetadata({
      params: Promise.resolve({
        slug: 'shop',
        category: 'smartphones',
        priceBandSlug: 'under-500k',
      }),
    });

    expect(metadata).toEqual({
      title: 'Price Band Guide Not Found',
      description: 'This price band guide is unavailable.',
      robots: { index: false, follow: true },
      alternates: null,
      openGraph: undefined,
      twitter: undefined,
    });

    mockLoadPriceBandPage.mockResolvedValueOnce({
      ...priceBandPageModel,
      isIndexable: false,
    });
    mockGetPriceBandStorefrontPathPrefix.mockResolvedValueOnce('');
    const ui = await PriceBandPageRuntime({
      params: Promise.resolve({
        slug: 'shop',
        category: 'smartphones',
        priceBandSlug: 'under-500k',
      }),
    });
    render(ui);

    expect(
      screen.getByRole('heading', { name: 'Price band guide not found' })
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back' })).toHaveAttribute(
      'href',
      '/'
    );
  });

  it('rejects when loadPriceBandPage throws a database error', async () => {
    mockLoadPriceBandPage.mockRejectedValue(
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
  });
});
