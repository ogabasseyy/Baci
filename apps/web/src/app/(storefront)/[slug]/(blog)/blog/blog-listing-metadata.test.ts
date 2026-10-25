import { beforeEach, describe, expect, it } from 'vitest';
import {
  buildListingResult,
  merchant,
  mockGetCachedBlogListing,
  resetBlogPageContentMocks,
} from './blog-page-content.test-utils';

const { buildBlogListingMetadata } = await import('./blog-listing-metadata');

describe('blog listing metadata builder', () => {
  beforeEach(() => {
    resetBlogPageContentMocks();
  });

  it('keeps the base blog listing indexable and canonical with an expanded description', async () => {
    mockGetCachedBlogListing.mockResolvedValueOnce({
      ...buildListingResult({
        merchant: {
          ...merchant,
          business_name: 'Ogabassey Electronics Store',
        },
      }),
    });
    const metadata = await buildBlogListingMetadata({
      slug: 'ogabassey.com',
      searchParams: {},
    });

    expect(metadata.robots).toMatchObject({ index: true, follow: true });
    expect(metadata.alternates?.canonical).toBe(
      'https://test-store.usebaci.com/blog'
    );
    expect(metadata.description?.length).toBeGreaterThanOrEqual(110);
    expect(metadata.description).toContain(
      'Read the latest tech news, smartphone and laptop reviews'
    );
  });

  it('uses neutral default description copy for non-Ogabassey storefronts', async () => {
    mockGetCachedBlogListing.mockResolvedValueOnce({
      ...buildListingResult({
        merchant: {
          ...merchant,
          business_name: 'Bella Fashion House',
        },
      }),
    });
    const metadata = await buildBlogListingMetadata({
      slug: 'bella-fashion',
      searchParams: {},
    });

    expect(metadata.description).toContain(
      'Read the latest articles, guides, and updates from Bella Fashion House.'
    );
    expect(metadata.description).not.toContain('tech news');
    expect(metadata.description).not.toContain('maintenance guides');
  });

  it('keeps known query category filters noindex and canonicalizes to the clean hub', async () => {
    mockGetCachedBlogListing.mockResolvedValueOnce({
      ...buildListingResult({
        merchant: {
          ...merchant,
          custom_domain: 'ogabassey.com',
        },
      }),
      categories: ['Smartphones', 'Laptops'],
    });

    const metadata = await buildBlogListingMetadata({
      slug: 'ogabassey.com',
      searchParams: { category: 'Smartphones' },
    });

    expect(metadata.title).toEqual({
      absolute: 'Smartphones Articles | Ogabassey',
    });
    expect(metadata.robots).toMatchObject({ index: false, follow: true });
    expect(metadata.alternates?.canonical).toBe(
      'https://ogabassey.com/blog/category/smartphones'
    );
    expect(metadata.openGraph?.url).toBe(
      'https://ogabassey.com/blog/category/smartphones'
    );
  });

  it('canonicalizes ?category=News to /blog/category/tech-news for Ogabassey', async () => {
    mockGetCachedBlogListing.mockResolvedValueOnce({
      ...buildListingResult({
        merchant: {
          ...merchant,
          custom_domain: 'ogabassey.com',
        },
      }),
      categories: ['Tech News', 'Laptops'],
    });

    const metadata = await buildBlogListingMetadata({
      slug: 'ogabassey.com',
      searchParams: { category: 'News' },
    });

    expect(metadata.title).toEqual({
      absolute: 'Tech News Articles | Ogabassey',
    });
    expect(metadata.robots).toMatchObject({ index: false, follow: true });
    expect(metadata.alternates?.canonical).toBe(
      'https://ogabassey.com/blog/category/tech-news'
    );
    expect(metadata.openGraph?.url).toBe(
      'https://ogabassey.com/blog/category/tech-news'
    );
  });

  it('canonicalizes ?category=Review to /blog/category/reviews for Ogabassey', async () => {
    mockGetCachedBlogListing.mockResolvedValueOnce({
      ...buildListingResult({
        merchant: {
          ...merchant,
          custom_domain: 'ogabassey.com',
        },
      }),
      categories: ['Reviews', 'Laptops'],
    });

    const metadata = await buildBlogListingMetadata({
      slug: 'ogabassey.com',
      searchParams: { category: 'Review' },
    });

    expect(metadata.title).toEqual({
      absolute: 'Reviews Articles | Ogabassey',
    });
    expect(metadata.robots).toMatchObject({ index: false, follow: true });
    expect(metadata.alternates?.canonical).toBe(
      'https://ogabassey.com/blog/category/reviews'
    );
    expect(metadata.openGraph?.url).toBe(
      'https://ogabassey.com/blog/category/reviews'
    );
  });

  it('keeps unknown query category filters noindex and canonicalizes to /blog', async () => {
    mockGetCachedBlogListing.mockResolvedValueOnce({
      ...buildListingResult({
        merchant: {
          ...merchant,
          custom_domain: 'ogabassey.com',
        },
      }),
      categories: ['Smartphones'],
    });

    const metadata = await buildBlogListingMetadata({
      slug: 'ogabassey.com',
      searchParams: { category: 'Unknown' },
    });

    expect(metadata.title).toEqual({
      absolute: 'Unknown Articles | Ogabassey',
    });
    expect(metadata.robots).toMatchObject({ index: false, follow: true });
    expect(metadata.alternates?.canonical).toBe('https://ogabassey.com/blog');
  });

  it('allows the clean category hub to be indexable', async () => {
    mockGetCachedBlogListing.mockResolvedValueOnce({
      ...buildListingResult({
        merchant: {
          ...merchant,
          custom_domain: 'ogabassey.com',
        },
      }),
      categories: ['Smartphones'],
    });

    const metadata = await buildBlogListingMetadata({
      slug: 'ogabassey.com',
      searchParams: { category: 'Smartphones' },
      canonicalUrl: 'https://ogabassey.com/blog/category/smartphones',
      indexable: true,
    });

    expect(metadata.robots).toMatchObject({ index: true, follow: true });
    expect(metadata.alternates?.canonical).toBe(
      'https://ogabassey.com/blog/category/smartphones'
    );
  });

  it('uses a page-scoped canonical for paginated category listings', async () => {
    mockGetCachedBlogListing.mockResolvedValueOnce({
      ...buildListingResult({
        merchant: {
          ...merchant,
          custom_domain: 'ogabassey.com',
        },
        totalPosts: 50,
      }),
      totalPages: 5,
      categories: ['Smartphones'],
    });

    const metadata = await buildBlogListingMetadata({
      slug: 'ogabassey.com',
      searchParams: { category: 'Smartphones', page: '2' },
    });

    expect(metadata.robots).toMatchObject({ index: false, follow: true });
    expect(metadata.alternates?.canonical).toBe(
      'https://ogabassey.com/blog?category=Smartphones&page=2'
    );
  });

  it('returns noindex not-found metadata for over-encoded bot category filters without the listing lookup', async () => {
    let overEncodedCategory = 'some phrase';
    for (let i = 0; i < 10; i++) {
      overEncodedCategory = encodeURIComponent(overEncodedCategory);
    }

    const metadata = await buildBlogListingMetadata({
      slug: 'ogabassey.com',
      searchParams: { category: overEncodedCategory },
    });

    expect(metadata).toEqual({
      title: 'Blog Not Found',
      robots: { index: false, follow: false },
    });
    expect(mockGetCachedBlogListing).not.toHaveBeenCalled();
  });

  it('clamps an extremely long search filter instead of 404ing, and still runs the lookup', async () => {
    const metadata = await buildBlogListingMetadata({
      slug: 'ogabassey.com',
      searchParams: { search: 'a'.repeat(4000) },
    });

    // Search is free-form text, not a slug: no "Blog Not Found" 404. The cached
    // lookup receives the query clamped to a bounded length.
    expect(metadata.title).not.toBe('Blog Not Found');
    expect(mockGetCachedBlogListing).toHaveBeenCalledWith(
      'ogabassey.com',
      expect.objectContaining({ searchQuery: 'a'.repeat(100) })
    );
  });

  it('returns noindex fallback metadata when listing data is missing', async () => {
    mockGetCachedBlogListing.mockResolvedValueOnce(null);

    const metadata = await buildBlogListingMetadata({
      slug: 'missing-store',
      searchParams: {},
    });

    expect(metadata).toEqual({
      title: 'Blog Not Found',
      robots: { index: false, follow: false },
    });
  });
});
