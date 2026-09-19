import { describe, expect, it } from 'vitest';
import { getPublishedBlogPostSlugsForProducts } from './get-published-blog-post-slugs-for-products';
import { makeSupabase } from './get-published-blog-post-slugs-for-products.test-support';

describe('getPublishedBlogPostSlugsForProducts slug casing', () => {
  it('preserves the stored casing of linked article slugs', async () => {
    const { supabase } = makeSupabase({
      data: [
        {
          blog_posts: {
            slug: 'Best-Phones-2026',
            status: 'published',
            published_at: '2026-08-01',
          },
        },
      ],
      error: null,
    });

    await expect(
      getPublishedBlogPostSlugsForProducts(supabase as never, 'merchant-1', [
        '123e4567-e89b-12d3-a456-426614174000',
      ])
    ).resolves.toEqual(['Best-Phones-2026']);
  });
});
