import { describe, expect, it } from 'vitest';
import { getPublishedBlogPostSlugsForProducts } from './get-published-blog-post-slugs-for-products';
import { makeSupabase } from './get-published-blog-post-slugs-for-products.test-support';

describe('getPublishedBlogPostSlugsForProducts category fallback', () => {
  it('preserves apostrophes when building category fallback candidates', async () => {
    const { categoryInSpy, supabase } = makeSupabase(
      { data: [], error: null },
      { data: [], error: null }
    );

    await expect(
      getPublishedBlogPostSlugsForProducts(
        supabase as never,
        'merchant-1',
        [],
        ["women's-fashion"]
      )
    ).resolves.toEqual({ slugs: [], incomplete: false });

    expect(categoryInSpy).toHaveBeenCalledWith('category', [
      "women's-fashion",
      "women's fashion",
      "Women's Fashion",
    ]);
  });

  it('matches punctuation-bearing categories through canonical normalization', async () => {
    const { categoryOrSpy, supabase } = makeSupabase(
      { data: [], error: null },
      { data: [], error: null },
      {
        data: [
          {
            slug: 'product-news-guide',
            status: 'published',
            published_at: '2026-08-03',
            category: 'Product & News!',
          },
        ],
        error: null,
      }
    );

    const result = await getPublishedBlogPostSlugsForProducts(
      supabase as never,
      'merchant-1',
      [],
      ['product-news']
    );

    expect(result.slugs).toEqual(['product-news-guide']);
    expect(result.incomplete).toBe(false);
    expect(categoryOrSpy.mock.calls[0]?.[0]).toContain(
      'category.ilike.*product*news*'
    );
  });

  it('matches canonical categories when the stored label contains an apostrophe', async () => {
    const { categoryOrSpy, supabase } = makeSupabase(
      { data: [], error: null },
      { data: [], error: null },
      {
        data: [
          {
            slug: 'womens-fashion-guide',
            status: 'published',
            published_at: '2026-08-04',
            category: "Women's Fashion",
          },
        ],
        error: null,
      }
    );

    const result = await getPublishedBlogPostSlugsForProducts(
      supabase as never,
      'merchant-1',
      [],
      ['womens-fashion']
    );

    expect(result.slugs).toEqual(['womens-fashion-guide']);
    expect(result.incomplete).toBe(false);
    expect(categoryOrSpy.mock.calls[0]?.[0]).toContain(
      'category.ilike.*w*o*m*e*n*s*f*a*s*h*i*o*n*'
    );
  });

  it('matches canonical categories across multiple punctuation boundaries', async () => {
    const { categoryOrSpy, supabase } = makeSupabase(
      { data: [], error: null },
      { data: [], error: null },
      {
        data: [
          {
            slug: 'womens-childrens-fashion-guide',
            status: 'published',
            published_at: '2026-08-05',
            category: "Women's & Children's Fashion",
          },
        ],
        error: null,
      }
    );

    const result = await getPublishedBlogPostSlugsForProducts(
      supabase as never,
      'merchant-1',
      [],
      ['womens-childrens-fashion']
    );

    expect(result.slugs).toEqual(['womens-childrens-fashion-guide']);
    expect(result.incomplete).toBe(false);
    expect(categoryOrSpy.mock.calls[0]?.[0]).toContain(
      'category.ilike.*w*o*m*e*n*s*c*h*i*l*d*r*e*n*s*f*a*s*h*i*o*n*'
    );
  });

  it('keeps category pagination deterministic when timestamps tie', async () => {
    const { categoryPages, supabase } = makeSupabase(
      { data: [], error: null },
      { data: [], error: null },
      { data: [], error: null }
    );
    const publishedAt = '2026-08-06T00:00:00.000Z';
    categoryPages.exact[0] = {
      data: Array.from({ length: 256 }, (_, index) => ({
        slug: `tied-guide-${index}`,
        status: 'published',
        published_at: publishedAt,
        category: 'smartphones',
      })),
      error: null,
    };
    categoryPages.exact[1] = {
      data: [
        {
          slug: 'tied-guide-256',
          status: 'published',
          published_at: publishedAt,
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

    expect(result.slugs).toContain('tied-guide-256');
    expect(result.incomplete).toBe(false);
  });
});
