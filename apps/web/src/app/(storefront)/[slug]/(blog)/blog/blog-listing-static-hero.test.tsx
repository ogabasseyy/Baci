import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getCachedBlogListing } from '@/lib/cached-data';
import { preloadOgabasseyRootBlogListingHeroImage } from './blog-listing-hero-image-preload';

vi.mock('@/lib/cached-data', () => ({
  getCachedBlogListing: vi.fn(),
}));

vi.mock('@/lib/store-url', () => ({
  buildStoreUrl: () => 'https://ogabassey.com',
}));

vi.mock('./blog-listing-hero-image-preload', () => ({
  getBlogListingHeroPost: (posts: Array<{ featured?: boolean }>) =>
    posts.find((post) => post.featured === true) ?? posts[0],
  preloadOgabasseyRootBlogListingHeroImage: vi.fn(),
}));

vi.mock('@/components/storefront/ogabassey/pages/blog-featured-story', () => ({
  BlogFeaturedStory: ({
    featuredPost,
    imageSrc,
  }: {
    featuredPost: { title: string };
    imageSrc: string;
  }) => (
    <article>
      <span data-hero-src={imageSrc}>{featuredPost.title}</span>
    </article>
  ),
}));

const { BlogListingStaticHero } = await import('./blog-listing-static-hero');

describe('BlogListingStaticHero', () => {
  beforeEach(() => {
    vi.mocked(getCachedBlogListing).mockReset();
    vi.mocked(preloadOgabasseyRootBlogListingHeroImage).mockClear();
  });

  it('paints the featured listing image without waiting for searchParams', async () => {
    vi.mocked(getCachedBlogListing).mockResolvedValueOnce({
      merchant: {
        business_name: 'Ogabassey',
        custom_domain: 'ogabassey.com',
        slug: 'ogabassey',
        template_id: 'ogabassey',
      },
      posts: [
        {
          id: 'post-1',
          title: 'Featured listing post',
          slug: 'featured-listing-post',
          excerpt: 'Hero excerpt',
          category: 'News',
          author_name: 'Ogabassey',
          published_at: '2026-03-28T10:00:00.000Z',
          featured_image_url: 'https://cdn.example.com/hero.png',
          reading_time_minutes: 4,
          featured: true,
        },
      ],
    } as unknown as Awaited<ReturnType<typeof getCachedBlogListing>>);

    render(
      await BlogListingStaticHero({
        params: Promise.resolve({ slug: 'ogabassey.com' }),
      })
    );

    expect(screen.getByText('Featured listing post')).toBeInTheDocument();
    expect(screen.getByText('Featured listing post')).toHaveAttribute(
      'data-hero-src',
      'https://cdn.example.com/hero.png'
    );
    expect(getCachedBlogListing).toHaveBeenCalledWith('ogabassey.com');
    expect(preloadOgabasseyRootBlogListingHeroImage).toHaveBeenCalledWith({
      posts: expect.any(Array),
      templateId: 'ogabassey',
    });
  });

  it('renders nothing for non-Ogabassey templates', async () => {
    vi.mocked(getCachedBlogListing).mockResolvedValueOnce({
      merchant: {
        business_name: 'Other Store',
        slug: 'other-store',
        template_id: 'modern',
      },
      posts: [
        {
          id: 'post-1',
          title: 'Other post',
          slug: 'other-post',
          featured_image_url: 'https://cdn.example.com/other.png',
        },
      ],
    } as unknown as Awaited<ReturnType<typeof getCachedBlogListing>>);

    const { container } = render(
      await BlogListingStaticHero({
        params: Promise.resolve({ slug: 'other-store' }),
      })
    );

    expect(container).toBeEmptyDOMElement();
    expect(preloadOgabasseyRootBlogListingHeroImage).not.toHaveBeenCalled();
  });
});
