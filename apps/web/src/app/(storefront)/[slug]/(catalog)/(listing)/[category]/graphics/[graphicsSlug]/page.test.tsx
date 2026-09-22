import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockCategoryPageContent, mockConnection, mockLoadHub } = vi.hoisted(
  () => ({
    mockCategoryPageContent: vi.fn(),
    mockConnection: vi.fn(),
    mockLoadHub: vi.fn(),
  })
);

vi.mock('next/server', () => ({ connection: mockConnection }));
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
}));
vi.mock('@/lib/store-url', () => ({
  buildStoreUrl: () => 'https://ogabassey.com',
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

  it('returns not found for an invalid page parameter', async () => {
    await expect(
      generateMetadata({
        ...props,
        searchParams: Promise.resolve({ page: 'invalid' }),
      })
    ).rejects.toThrow('NEXT_NOT_FOUND');
  });

  it('returns not found when the requested hub is not publishable', async () => {
    mockLoadHub.mockResolvedValueOnce(null);

    await expect(generateMetadata(props)).rejects.toThrow('NEXT_NOT_FOUND');
  });
});
