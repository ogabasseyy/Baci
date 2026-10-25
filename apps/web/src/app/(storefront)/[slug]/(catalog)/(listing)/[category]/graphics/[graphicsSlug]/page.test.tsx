import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockCategoryPageContent, mockConnection, mockHeaders, mockLoadHub } =
  vi.hoisted(() => ({
    mockCategoryPageContent: vi.fn(),
    mockConnection: vi.fn(),
    mockHeaders: vi.fn(() => Promise.resolve(new Headers())),
    mockLoadHub: vi.fn(),
  }));

vi.mock('next/headers', () => ({ headers: mockHeaders }));
vi.mock('next/server', () => ({ connection: mockConnection }));
vi.mock('@/lib/store-url', () => ({
  buildStoreUrl: () => 'https://ogabassey.com',
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
vi.mock('../../category-page-content', () => ({
  CategoryPageContent: (props: unknown) => {
    mockCategoryPageContent(props);
    return <div>Filtered inventory</div>;
  },
}));
vi.mock('./load-gaming-graphics-hub', () => ({
  loadGamingGraphicsHub: (...args: unknown[]) => mockLoadHub(...args),
}));

import { GamingGraphicsHubRuntime, generateMetadata } from './page';

const props = {
  params: Promise.resolve({
    category: 'gaming-laptops',
    graphicsSlug: 'rtx-4070',
    slug: 'ogabassey.com',
  }),
  searchParams: Promise.resolve({}),
};

describe('GamingGraphicsHubPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockConnection.mockResolvedValue(undefined);
    mockHeaders.mockResolvedValue(new Headers());
    mockLoadHub.mockResolvedValue({
      availableHubs: [{ slug: 'rtx-4070', model: '4070', label: 'RTX 4070' }],
      canonicalBaseUrl:
        'https://ogabassey.com/gaming-laptops/graphics/rtx-4070',
      countryName: 'Nigeria',
      currentPage: 1,
      hub: { slug: 'rtx-4070', model: '4070', label: 'RTX 4070' },
      matchingGraphics: ['NVIDIA RTX 4070'],
      merchant: {
        business_name: 'Ogabassey',
        is_published: true,
        slug: 'ogabassey',
      },
      productCount: 12,
      totalPages: 1,
    });
  });

  it('publishes unique indexable metadata on the clean hub URL', async () => {
    const metadata = await generateMetadata(props);

    expect(metadata.title).toEqual({
      absolute: 'RTX 4070 Gaming Laptops Price in Nigeria | Ogabassey',
    });
    expect(metadata.alternates).toEqual({
      canonical: 'https://ogabassey.com/gaming-laptops/graphics/rtx-4070',
    });
    expect(metadata.robots).toMatchObject({ index: true, follow: true });
  });

  it('noindexes hub URLs with ignored non-hub filters', async () => {
    const metadata = await generateMetadata({
      params: props.params,
      searchParams: Promise.resolve({ brand: 'HP' }),
    });

    expect(metadata.alternates).toEqual({
      canonical: 'https://ogabassey.com/gaming-laptops/graphics/rtx-4070',
    });
    expect(metadata.robots).toMatchObject({ index: false, follow: true });
  });

  it('noindexes hub URLs carrying an ignored graphics selection', async () => {
    const metadata = await generateMetadata({
      params: props.params,
      searchParams: Promise.resolve({ graphics: 'RTX 4060' }),
    });

    expect(metadata.robots).toMatchObject({ index: false, follow: true });
  });

  it('noindexes hub URLs carrying a listing-transition hub token', async () => {
    const metadata = await generateMetadata({
      params: props.params,
      searchParams: Promise.resolve({ graphicsHub: 'rtx-4070' }),
    });

    expect(metadata.robots).toMatchObject({ index: false, follow: true });
  });

  it('noindexes hubs for unpublished stores', async () => {
    mockLoadHub.mockResolvedValue({
      availableHubs: [{ slug: 'rtx-4070', model: '4070', label: 'RTX 4070' }],
      canonicalBaseUrl:
        'https://ogabassey.com/gaming-laptops/graphics/rtx-4070',
      countryName: 'Nigeria',
      currentPage: 1,
      hub: { slug: 'rtx-4070', model: '4070', label: 'RTX 4070' },
      matchingGraphics: ['NVIDIA RTX 4070'],
      merchant: {
        business_name: 'Ogabassey',
        is_published: false,
        slug: 'ogabassey',
      },
      productCount: 12,
      totalPages: 1,
    });

    const metadata = await generateMetadata(props);

    expect(metadata.robots).toMatchObject({ index: false, follow: true });
  });

  it('renders the filtered category inventory below a single hub H1', async () => {
    render(await GamingGraphicsHubRuntime(props));

    expect(
      await screen.findByRole('heading', {
        name: 'RTX 4070 Gaming Laptops in Nigeria',
      })
    ).toBeInTheDocument();
    expect(await screen.findByText('Filtered inventory')).toBeInTheDocument();
    expect(mockCategoryPageContent).toHaveBeenCalledWith(
      expect.objectContaining({
        canonicalBaseUrl:
          'https://ogabassey.com/gaming-laptops/graphics/rtx-4070',
        seoPageName: 'RTX 4070 Gaming Laptops',
        titleHeading: 'h2',
      })
    );
  });

  it('returns marker-free not-found metadata and renders fallback for an invalid page parameter', async () => {
    const invalidProps = {
      ...props,
      searchParams: Promise.resolve({ page: 'invalid' }),
    };

    const metadata = await generateMetadata(invalidProps);
    expect(metadata).toEqual({
      title: 'Graphics Hub Not Found',
      description: 'This graphics hub is unavailable.',
      robots: { index: false, follow: true },
      alternates: null,
      openGraph: undefined,
      twitter: undefined,
    });

    render(await GamingGraphicsHubRuntime(invalidProps));
    expect(
      screen.getByRole('heading', { name: 'Graphics hub not found' })
    ).toBeInTheDocument();
    expect(
      screen.getByText('This graphics hub is unavailable or has moved.')
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back' })).toHaveAttribute(
      'href',
      '/'
    );
  });

  it('returns marker-free not-found metadata and renders fallback when requested hub is not publishable', async () => {
    mockLoadHub.mockResolvedValueOnce(null);

    const metadata = await generateMetadata(props);
    expect(metadata).toEqual({
      title: 'Graphics Hub Not Found',
      description: 'This graphics hub is unavailable.',
      robots: { index: false, follow: true },
      alternates: null,
      openGraph: undefined,
      twitter: undefined,
    });

    mockLoadHub.mockResolvedValueOnce(null);
    mockHeaders.mockResolvedValueOnce(
      new Headers({
        host: 'shop.usebaci.com',
        'x-merchant-slug': 'shop',
      })
    );
    render(
      await GamingGraphicsHubRuntime({
        ...props,
        params: Promise.resolve({
          category: 'gaming-laptops',
          graphicsSlug: 'rtx-4070',
          slug: 'shop',
        }),
      })
    );
    expect(
      screen.getByRole('heading', { name: 'Graphics hub not found' })
    ).toBeInTheDocument();
    expect(
      screen.getByText('This graphics hub is unavailable or has moved.')
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back' })).toHaveAttribute(
      'href',
      '/'
    );
  });
});
