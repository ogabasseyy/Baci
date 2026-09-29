import { describe, expect, it } from 'vitest';
import { getPublishedBlogPostSlugsForProducts } from './get-published-blog-post-slugs-for-products';
import { makeSupabase } from './get-published-blog-post-slugs-for-products.test-support';

describe('getPublishedBlogPostSlugsForProducts', () => {
  it('returns unique published post slugs for the changed product ids', async () => {
    const { inSpy, supabase } = makeSupabase({
      data: [
        {
          blog_posts: {
            slug: 'phone-guide',
            status: 'published',
            published_at: '2026-08-01',
          },
        },
        {
          blog_posts: [
            {
              slug: 'phone-guide',
              status: 'published',
              published_at: '2026-08-01',
            },
          ],
        },
        {
          blog_posts: {
            slug: 'draft-guide',
            status: 'draft',
            published_at: null,
          },
        },
        {
          blog_posts: {
            slug: 'unpublished-guide',
            status: 'published',
            published_at: null,
          },
        },
      ],
      error: null,
    });

    const result = await getPublishedBlogPostSlugsForProducts(
      supabase as never,
      ' merchant-1 ',
      [
        '123e4567-e89b-12d3-a456-426614174000',
        '123e4567-e89b-12d3-a456-426614174000',
        ' 123e4567-e89b-12d3-a456-426614174001 ',
        'sku-2',
      ]
    );

    expect(result.slugs).toEqual(['phone-guide']);
    expect(result.incomplete).toBe(false);
    expect(inSpy).toHaveBeenCalledWith('product_id', [
      '123e4567-e89b-12d3-a456-426614174000',
      '123e4567-e89b-12d3-a456-426614174001',
    ]);
  });

  it('returns an empty list without querying for missing ids', async () => {
    const { supabase } = makeSupabase({ data: [], error: null });

    await expect(
      getPublishedBlogPostSlugsForProducts(supabase as never, 'merchant-1', [
        ' ',
      ])
    ).resolves.toEqual({ slugs: [], incomplete: false });
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it('throws when the relationship lookup fails with no rows to preserve', async () => {
    const error = { message: 'timeout' };
    const { supabase } = makeSupabase({ data: null, error });
    const consoleSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);

    try {
      await expect(
        getPublishedBlogPostSlugsForProducts(supabase as never, 'merchant-1', [
          '123e4567-e89b-12d3-a456-426614174000',
        ])
      ).rejects.toThrow(/no rows to preserve/);
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('no rows preserved'),
        expect.objectContaining({ merchantId: 'merchant-1', error })
      );
    } finally {
      consoleSpy.mockRestore();
    }
  });

  it('includes published category-fallback posts and deduplicates linked slugs', async () => {
    const { categoryInSpy, categoryRangeSpy, inSpy, supabase } = makeSupabase(
      {
        data: [
          {
            blog_posts: {
              slug: 'linked-guide',
              status: 'published',
              published_at: '2026-08-01',
            },
          },
        ],
        error: null,
      },
      {
        data: [
          {
            slug: 'linked-guide',
            status: 'published',
            published_at: '2026-08-01',
            category: 'Smartphones',
          },
          {
            slug: 'fallback-guide',
            status: 'published',
            published_at: '2026-08-02',
            category: 'smartphones',
          },
          {
            slug: 'draft-fallback',
            status: 'draft',
            published_at: null,
            category: 'smartphones',
          },
        ],
        error: null,
      }
    );

    const result = await getPublishedBlogPostSlugsForProducts(
      supabase as never,
      'merchant-1',
      ['123e4567-e89b-12d3-a456-426614174000'],
      ['smartphones']
    );

    expect(result.slugs).toEqual(['linked-guide', 'fallback-guide']);
    expect(result.incomplete).toBe(false);
    expect(inSpy).toHaveBeenCalledWith('product_id', [
      '123e4567-e89b-12d3-a456-426614174000',
    ]);
    expect(categoryInSpy).toHaveBeenCalledWith('category', [
      'smartphones',
      'Smartphones',
    ]);
    expect(categoryRangeSpy).toHaveBeenCalledWith(0, 255);
  });
});
