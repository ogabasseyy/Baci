import { render } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  buildListingResult,
  mockGetCachedBlogListing,
  resetBlogPageContentMocks,
} from './blog-page-content.test-utils';

const { BlogPageContent } = await import('./blog-page-content');

describe('BlogPageContent robots meta', () => {
  beforeEach(() => {
    resetBlogPageContentMocks();
  });

  it('omits robots meta tag on clean page 1 routes and clean category routes', async () => {
    const cleanListing = render(
      await BlogPageContent({
        params: Promise.resolve({ slug: 'test-store' }),
        searchParams: Promise.resolve({}),
      })
    );
    expect(document.querySelector('meta[name="robots"]')).toBeNull();
    cleanListing.unmount();

    const cleanCategoryListing = render(
      await BlogPageContent({
        categoryOverride: 'Smartphones',
        isCleanCategoryRoute: true,
        params: Promise.resolve({ slug: 'test-store' }),
        searchParams: Promise.resolve({}),
      })
    );
    expect(document.querySelector('meta[name="robots"]')).toBeNull();
    cleanCategoryListing.unmount();
  });

  it('emits a noindex, follow robots meta tag on paginated, search, or query-category blog listings', async () => {
    mockGetCachedBlogListing.mockResolvedValueOnce(
      buildListingResult({ totalPosts: 40 })
    );
    const paginatedListing = render(
      await BlogPageContent({
        params: Promise.resolve({ slug: 'test-store' }),
        searchParams: Promise.resolve({ page: '2' }),
      })
    );
    expect(document.querySelector('meta[name="robots"]')).toHaveAttribute(
      'content',
      'noindex, follow'
    );
    paginatedListing.unmount();

    mockGetCachedBlogListing.mockResolvedValueOnce(
      buildListingResult({ totalPosts: 5 })
    );
    const searchListing = render(
      await BlogPageContent({
        params: Promise.resolve({ slug: 'test-store' }),
        searchParams: Promise.resolve({ search: 'iphone' }),
      })
    );
    expect(document.querySelector('meta[name="robots"]')).toHaveAttribute(
      'content',
      'noindex, follow'
    );
    searchListing.unmount();

    mockGetCachedBlogListing.mockResolvedValueOnce(
      buildListingResult({ totalPosts: 5 })
    );
    const pageOneCategoryQueryListing = render(
      await BlogPageContent({
        params: Promise.resolve({ slug: 'test-store' }),
        searchParams: Promise.resolve({ category: 'Product' }),
      })
    );
    expect(document.querySelector('meta[name="robots"]')).toHaveAttribute(
      'content',
      'noindex, follow'
    );
    pageOneCategoryQueryListing.unmount();

    mockGetCachedBlogListing.mockResolvedValueOnce(
      buildListingResult({ totalPosts: 40 })
    );
    const queryCategoryPaginatedListing = render(
      await BlogPageContent({
        params: Promise.resolve({ slug: 'test-store' }),
        searchParams: Promise.resolve({ category: 'Smartphones', page: '2' }),
      })
    );
    expect(document.querySelector('meta[name="robots"]')).toHaveAttribute(
      'content',
      'noindex, follow'
    );
    queryCategoryPaginatedListing.unmount();
  });
});
