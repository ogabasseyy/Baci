import { describe, expect, it } from 'vitest';
import { getPublishedBlogPostSlugsForProducts } from './get-published-blog-post-slugs-for-products';
import { makeSupabase } from './get-published-blog-post-slugs-for-products.test-support';

describe('getPublishedBlogPostSlugsForProducts pagination', () => {
  it('paginates explicitly linked posts beyond one response page', async () => {
    const firstPage = Array.from({ length: 256 }, (_, index) => ({
      id: `link-${index}`,
      blog_post_id: `post-${index}`,
      blog_posts: {
        slug: index === 0 ? 'newest-linked' : `linked-${index}`,
        status: 'published',
        published_at: '2026-08-01',
      },
    }));
    const { linkedPages, linkedRangeSpy, supabase } = makeSupabase({
      data: firstPage,
      error: null,
    });
    linkedPages[1] = {
      data: [
        {
          id: 'link-oldest',
          blog_post_id: 'post-oldest',
          blog_posts: {
            slug: 'oldest-linked',
            status: 'published',
            published_at: '2025-01-01',
          },
        },
      ],
      error: null,
    };

    const result = await getPublishedBlogPostSlugsForProducts(
      supabase as never,
      'merchant-1',
      ['123e4567-e89b-12d3-a456-426614174000']
    );

    expect(result).toContain('newest-linked');
    expect(result).toContain('oldest-linked');
    expect(linkedRangeSpy).toHaveBeenCalledWith(256, 511);
  });

  it('paginates category fallback posts beyond one page', async () => {
    const firstPage = Array.from({ length: 256 }, (_, index) => ({
      slug: index === 0 ? 'newest-fallback' : `fallback-${index}`,
      status: 'published',
      published_at: `2026-08-${String(31 - (index % 28)).padStart(2, '0')}`,
      category: 'smartphones',
    }));
    const { categoryPages, categoryRangeSpy, supabase } = makeSupabase(
      { data: [], error: null },
      { data: firstPage, error: null },
      { data: [], error: null }
    );
    categoryPages.exact[1] = {
      data: [
        {
          slug: 'oldest-fallback',
          status: 'published',
          published_at: '2025-01-01',
          category: 'smartphones',
        },
      ],
      error: null,
    };

    const result = await getPublishedBlogPostSlugsForProducts(
      supabase as never,
      'merchant-1',
      [],
      ['smartphones']
    );

    expect(result).toContain('newest-fallback');
    expect(result).toContain('oldest-fallback');
    expect(categoryRangeSpy).toHaveBeenCalledWith(256, 511);
  });

  it('keeps earlier category rows when a later page fails', async () => {
    const firstPage = Array.from({ length: 256 }, (_, index) => ({
      slug: index === 0 ? 'fetched-before-error' : `fallback-${index}`,
      status: 'published',
      published_at: '2026-08-01',
      category: 'smartphones',
    }));
    const { categoryPages, supabase } = makeSupabase(
      { data: [], error: null },
      { data: firstPage, error: null }
    );
    categoryPages.exact[1] = {
      data: [],
      error: new Error('category page unavailable'),
    };

    const result = await getPublishedBlogPostSlugsForProducts(
      supabase as never,
      'merchant-1',
      [],
      ['smartphones']
    );

    expect(result).toContain('fetched-before-error');
  });
});
