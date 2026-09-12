import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  buildListingResult,
  merchant,
  mockGetCachedBlogListing,
  mockGetTemplate,
  mockPreloadBlogListingFeaturedImage,
  mockTemplateBlogRenderer,
  postsPayload,
  resetBlogPageContentMocks,
} from './blog-page-content.test-utils';
import { ogabasseyBlogLcpSnapshot } from './ogabassey-blog-lcp-snapshot';

const { BlogPageContent } = await import('./blog-page-content');

describe('BlogPageContent featured-image preload', () => {
  beforeEach(() => {
    resetBlogPageContentMocks();
  });

  it('preloads the root listing featured image before rendering the blog UI', async () => {
    render(
      await BlogPageContent({
        params: Promise.resolve({ slug: 'ogabassey' }),
        searchParams: Promise.resolve({}),
      })
    );

    expect(mockPreloadBlogListingFeaturedImage).toHaveBeenCalledWith(
      'https://cdn.example.com/blog-cover.png'
    );
  });

  it('does not preload a featured listing image when the live story matches the committed snapshot', async () => {
    mockGetCachedBlogListing.mockResolvedValueOnce(
      buildListingResult({
        posts: [
          {
            ...postsPayload[0],
            slug: ogabasseyBlogLcpSnapshot.featuredPost.slug,
          },
        ],
      })
    );

    render(
      await BlogPageContent({
        hideFeaturedStory: true,
        params: Promise.resolve({ slug: 'ogabassey' }),
        searchParams: Promise.resolve({}),
      })
    );

    expect(mockPreloadBlogListingFeaturedImage).not.toHaveBeenCalled();
  });

  it('does not preload a live featured image when the snapshot hero is committed', async () => {
    render(
      await BlogPageContent({
        hideFeaturedStory: true,
        params: Promise.resolve({ slug: 'ogabassey' }),
        searchParams: Promise.resolve({}),
      })
    );

    expect(mockPreloadBlogListingFeaturedImage).not.toHaveBeenCalled();
    expect(document.querySelector('[data-blog-live-featured]')).toBeNull();
  });

  it('preloads the same first listing image used by the OgaBassey hero story', async () => {
    const firstPost = {
      ...postsPayload[0],
      id: 'post-first',
      title: 'First Post',
      slug: 'first-post',
      featured_image_url: 'https://cdn.example.com/first.png',
    };
    const secondPost = {
      ...postsPayload[0],
      id: 'post-second',
      title: 'Second Post',
      slug: 'second-post',
      featured_image_url: 'https://cdn.example.com/second.png',
    };
    mockGetCachedBlogListing.mockResolvedValueOnce(
      buildListingResult({
        posts: [firstPost, secondPost],
      })
    );
    mockGetTemplate.mockReturnValueOnce({
      getComponents: async () => ({
        Blog: () => <div>OgaBassey blog component</div>,
      }),
    });

    render(
      await BlogPageContent({
        params: Promise.resolve({ slug: 'ogabassey' }),
        searchParams: Promise.resolve({}),
      })
    );

    expect(mockPreloadBlogListingFeaturedImage).toHaveBeenCalledWith(
      'https://cdn.example.com/first.png'
    );
    expect(mockTemplateBlogRenderer).toHaveBeenCalledWith(
      expect.objectContaining({
        blogPosts: expect.arrayContaining([
          expect.objectContaining({
            slug: 'first-post',
          }),
        ]),
      })
    );
  });

  it('does not preload a template-specific hero image for non-Ogabassey templates', async () => {
    mockGetCachedBlogListing.mockResolvedValueOnce(
      buildListingResult({
        merchant: {
          ...merchant,
          template_id: 'modern',
        },
      })
    );
    mockGetTemplate.mockReturnValueOnce({
      getComponents: async () => ({
        Blog: () => <div>Custom blog component</div>,
      }),
    });

    render(
      await BlogPageContent({
        params: Promise.resolve({ slug: 'test-store' }),
        searchParams: Promise.resolve({}),
      })
    );

    expect(screen.getByText('Template blog')).toBeInTheDocument();
    expect(mockPreloadBlogListingFeaturedImage).not.toHaveBeenCalled();
  });

  it('does not preload a featured image for filtered listings without a hero story', async () => {
    render(
      await BlogPageContent({
        params: Promise.resolve({ slug: 'ogabassey' }),
        searchParams: Promise.resolve({ category: 'News', search: 'iphone' }),
      })
    );

    expect(mockPreloadBlogListingFeaturedImage).not.toHaveBeenCalled();
  });
});
