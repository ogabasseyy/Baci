import { describe, expect, it } from 'vitest';
import { getPublishedBlogPostSlugsForProducts } from './get-published-blog-post-slugs-for-products';
import { makeSupabase } from './get-published-blog-post-slugs-for-products.test-support';

describe('getPublishedBlogPostSlugsForProducts category fallback', () => {
  it('excludes a post that has an active explicit product link', async () => {
    const { supabase } = makeSupabase(
      {
        data: [
          {
            blog_post_id: 'post-linked',
            product: { status: 'active' },
          },
        ],
        error: null,
      },
      {
        data: [
          {
            id: 'post-linked',
            slug: 'explicit-guide',
            status: 'published',
            published_at: '2026-09-01',
            category: 'smartphones',
          },
        ],
        error: null,
      }
    );

    await expect(
      getPublishedBlogPostSlugsForProducts(
        supabase as never,
        'merchant-1',
        [],
        ['smartphones']
      )
    ).resolves.toEqual([]);
  });
});
