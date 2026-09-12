import { beforeEach, describe, expect, it, vi } from 'vitest';
import { preloadBlogListingFeaturedImage } from './blog-listing-featured-image-preload';
import { preloadOgabasseyRootBlogListingHeroImage } from './blog-listing-hero-image-preload';

vi.mock('./blog-listing-featured-image-preload', () => ({
  preloadBlogListingFeaturedImage: vi.fn(),
}));

describe('preloadOgabasseyRootBlogListingHeroImage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('preloads the promoted hero image when one root OgaBassey listing post is featured', () => {
    preloadOgabasseyRootBlogListingHeroImage({
      category: undefined,
      posts: [
        {
          featured: false,
          featured_image_url: 'https://cdn.example.com/regular.png',
        },
        {
          featured: true,
          featured_image_url: 'https://cdn.example.com/promoted.png',
        },
      ],
      searchQuery: undefined,
      templateId: 'ogabassey',
    });

    expect(preloadBlogListingFeaturedImage).toHaveBeenCalledWith(
      'https://cdn.example.com/promoted.png'
    );
  });

  it('falls back to the first post image when no root listing post is promoted', () => {
    preloadOgabasseyRootBlogListingHeroImage({
      category: undefined,
      posts: [
        {
          featured_image_url: 'https://cdn.example.com/first.png',
        },
      ],
      searchQuery: undefined,
      templateId: 'ogabassey',
    });

    expect(preloadBlogListingFeaturedImage).toHaveBeenCalledWith(
      'https://cdn.example.com/first.png'
    );
  });

  it('preloads when the explicit category matches the rendered All listing', () => {
    preloadOgabasseyRootBlogListingHeroImage({
      category: 'All',
      posts: [
        {
          featured_image_url: 'https://cdn.example.com/all.png',
        },
      ],
      searchQuery: undefined,
      templateId: 'ogabassey',
    });

    expect(preloadBlogListingFeaturedImage).toHaveBeenCalledWith(
      'https://cdn.example.com/all.png'
    );
  });

  it('skips non-root or non-OgaBassey listings', () => {
    const posts = [
      {
        featured: true,
        featured_image_url: 'https://cdn.example.com/promoted.png',
      },
    ];

    preloadOgabasseyRootBlogListingHeroImage({
      category: 'News',
      posts,
      searchQuery: undefined,
      templateId: 'ogabassey',
    });
    preloadOgabasseyRootBlogListingHeroImage({
      category: 'all',
      posts,
      searchQuery: undefined,
      templateId: 'ogabassey',
    });
    preloadOgabasseyRootBlogListingHeroImage({
      category: undefined,
      posts,
      searchQuery: 'iphone',
      templateId: 'ogabassey',
    });
    preloadOgabasseyRootBlogListingHeroImage({
      category: undefined,
      posts,
      searchQuery: undefined,
      templateId: 'modern',
    });

    expect(preloadBlogListingFeaturedImage).not.toHaveBeenCalled();
  });

  it('selects the promoted listing post before falling back to the first post', async () => {
    const { getBlogListingHeroPost } = await import(
      './blog-listing-hero-image-preload'
    );

    expect(
      getBlogListingHeroPost([
        { featured: false, featured_image_url: 'first.png' },
        { featured: true, featured_image_url: 'promoted.png' },
      ])?.featured_image_url
    ).toBe('promoted.png');
    expect(
      getBlogListingHeroPost([{ featured_image_url: 'first.png' }])
        ?.featured_image_url
    ).toBe('first.png');
  });
});
