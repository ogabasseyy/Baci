import { describe, expect, it, vi } from 'vitest';
import { filterCategoryBlogPostRowsWithoutActiveLinks } from './filter-category-blog-post-rows';

function makeSupabase(result: { data: unknown; error: unknown }) {
  const builder: Record<string, ReturnType<typeof vi.fn>> = {};
  for (const method of ['eq', 'in', 'order']) {
    builder[method] = vi.fn(() => builder);
  }
  builder.range = vi.fn(() => Promise.resolve(result));
  return {
    from: vi.fn(() => ({ select: vi.fn(() => builder) })),
  };
}

describe('filterCategoryBlogPostRowsWithoutActiveLinks', () => {
  it('removes category rows with an active explicit product link', async () => {
    const supabase = makeSupabase({
      data: [
        {
          blog_post_id: 'post-linked',
          product: { status: 'active' },
        },
        {
          blog_post_id: 'post-draft-product',
          product: { status: 'draft' },
        },
      ],
      error: null,
    });
    const rows = [
      { id: 'post-linked', slug: 'linked' },
      { id: 'post-draft-product', slug: 'fallback' },
      { id: 'post-no-link', slug: 'legacy' },
    ];

    const result = await filterCategoryBlogPostRowsWithoutActiveLinks(
      supabase as never,
      'merchant-1',
      rows
    );

    expect(result).toEqual([
      { id: 'post-draft-product', slug: 'fallback' },
      { id: 'post-no-link', slug: 'legacy' },
    ]);
  });

  it('keeps category rows when the relationship read fails', async () => {
    const rows = [{ id: 'post-1', slug: 'legacy' }];
    const supabase = makeSupabase({
      data: [
        {
          blog_post_id: 'post-1',
          product: { status: 'active' },
        },
      ],
      error: new Error('relationship unavailable'),
    });

    await expect(
      filterCategoryBlogPostRowsWithoutActiveLinks(
        supabase as never,
        'merchant-1',
        rows
      )
    ).resolves.toEqual(rows);
  });

  it('does not query when category rows have no post ids', async () => {
    const supabase = makeSupabase({ data: [], error: null });
    const rows = [{ slug: 'legacy' }];

    await expect(
      filterCategoryBlogPostRowsWithoutActiveLinks(
        supabase as never,
        'merchant-1',
        rows
      )
    ).resolves.toEqual(rows);
    expect(supabase.from).not.toHaveBeenCalled();
  });
});
