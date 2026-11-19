import { render, screen, within } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import {
  buildListingResult,
  mockBlogClassificationRead,
  mockBuildBlogClusterCollections,
  mockGetCachedBlogListing,
  postsPayload,
  resetBlogPageContentMocks,
} from './blog-page-content.test-utils';

const { BlogPageContent } = await import('./blog-page-content');
const { buildBlogClusterCollections } = await vi.importActual<
  typeof import('@/lib/storefront-content/build-blog-cluster-collections')
>('@/lib/storefront-content/build-blog-cluster-collections');

beforeEach(() => {
  resetBlogPageContentMocks();
  mockBuildBlogClusterCollections.mockImplementation(
    buildBlogClusterCollections
  );
});

it('renders persisted merchant buying guides in the actual listing guide collection', async () => {
  const posts = [
    {
      ...postsPayload[0],
      id: 'one',
      title: 'Apple iPhone ownership',
      slug: 'iphone-ownership',
      category: 'Smartphones',
      tags: [],
      excerpt: 'Information for owners.',
    },
    {
      ...postsPayload[0],
      id: 'two',
      title: 'Apple iPhone options',
      slug: 'iphone-options',
      category: 'Smartphones',
      tags: [],
      excerpt: 'Information for customers.',
    },
  ];
  mockGetCachedBlogListing.mockResolvedValue(buildListingResult({ posts }));
  mockBlogClassificationRead.mockResolvedValue({
    data: posts.map((post) => ({
      post_id: post.id,
      // Simulate a view-count write after the listing content was cached.
      post_updated_at: '2026-03-29T10:00:00.000Z',
      post_revision: post.classification_revision,
      intent: 'buying-guide',
      source: 'verified_receipt',
    })),
    error: null,
  });

  render(
    await BlogPageContent({
      params: Promise.resolve({ slug: 'test-store' }),
      searchParams: Promise.resolve({}),
    })
  );

  const guides = screen.getByRole('region', { name: 'Guide collections' });
  expect(
    within(guides).getByRole('link', { name: 'Apple iPhone ownership' })
  ).toHaveAttribute(
    'href',
    'https://test-store.usebaci.com/blog/iphone-ownership'
  );
  expect(mockBuildBlogClusterCollections).toHaveBeenCalledWith(
    expect.objectContaining({
      posts: expect.arrayContaining([
        expect.objectContaining({
          merchant_intent: 'buying-guide',
          merchant_intent_source: 'verified_receipt',
        }),
      ]),
    })
  );
});
