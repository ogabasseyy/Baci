import { describe, expect, it, vi } from 'vitest';
import { getPublishedBlogPostSlugsForProducts } from './get-published-blog-post-slugs-for-products';
import { makeSupabase } from './get-published-blog-post-slugs-for-products.test-support';

const PAGE_SIZE = 256;
const PRODUCT_ID = '123e4567-e89b-12d3-a456-426614174000';

function publishedRow(slug: string) {
  return {
    blog_posts: {
      slug,
      status: 'published',
      published_at: '2026-08-01',
    },
  };
}

function rejectingLinkedSupabase(
  rangeImpl: () =>
    | Promise<never>
    | Promise<{
        data: unknown;
        error: null;
      }>
) {
  const builder: Record<string, unknown> = {};
  builder.eq = vi.fn(() => builder);
  builder.not = vi.fn(() => builder);
  builder.order = vi.fn(() => builder);
  builder.in = vi.fn(() => builder);
  builder.range = vi.fn(rangeImpl);
  return { from: vi.fn(() => ({ select: vi.fn(() => builder) })) } as never;
}

describe('getPublishedBlogPostSlugsForProducts partial page failure', () => {
  it('resolves the rows already fetched and warns when a later page fails', async () => {
    const pageError = { message: 'page timeout' };
    const firstPage = Array.from({ length: PAGE_SIZE }, (_, index) =>
      publishedRow(`guide-${index}`)
    );
    const { linkedPages, supabase } = makeSupabase({
      data: [],
      error: null,
    });
    linkedPages.push(
      { data: firstPage, error: null },
      { data: null, error: pageError }
    );
    const warnSpy = vi
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);
    const errorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);

    try {
      const result = await getPublishedBlogPostSlugsForProducts(
        supabase as never,
        'merchant-1',
        ['123e4567-e89b-12d3-a456-426614174000']
      );

      expect(result).toHaveLength(PAGE_SIZE);
      expect(result).toContain('guide-0');
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('partial published-blog-post set'),
        expect.objectContaining({ merchantId: 'merchant-1', error: pageError })
      );
      expect(errorSpy).not.toHaveBeenCalled();
    } finally {
      warnSpy.mockRestore();
      errorSpy.mockRestore();
    }
  });

  it('throws when the category lookup fails with no rows preserved', async () => {
    const categoryError = { message: 'category unavailable' };
    const { supabase } = makeSupabase(
      { data: [], error: null },
      { data: null, error: categoryError }
    );
    const errorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);

    try {
      await expect(
        getPublishedBlogPostSlugsForProducts(
          supabase as never,
          'merchant-1',
          [],
          ['smartphones']
        )
      ).rejects.toThrow(/no rows to preserve/);
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('category-fallback'),
        expect.objectContaining({
          merchantId: 'merchant-1',
          error: categoryError,
        })
      );
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('propagates a rejected relationship read that preserves no rows', async () => {
    const failure = new Error('transport down');
    const supabase = rejectingLinkedSupabase(() => Promise.reject(failure));
    const errorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);

    try {
      await expect(
        getPublishedBlogPostSlugsForProducts(supabase, 'merchant-1', [
          PRODUCT_ID,
        ])
      ).rejects.toThrow(/no rows to preserve/);
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('no rows preserved'),
        expect.objectContaining({ merchantId: 'merchant-1', error: failure })
      );
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('treats a broken relationship client as a total lookup failure', async () => {
    const failure = new Error('client unavailable');
    const supabase = {
      from: vi.fn(() => {
        throw failure;
      }),
    } as never;
    const errorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);

    try {
      await expect(
        getPublishedBlogPostSlugsForProducts(supabase, 'merchant-1', [
          PRODUCT_ID,
        ])
      ).rejects.toThrow(/no rows to preserve/);
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('no rows preserved'),
        expect.objectContaining({ merchantId: 'merchant-1', error: failure })
      );
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('resolves preserved rows when a later relationship page rejects', async () => {
    const firstPage = Array.from({ length: PAGE_SIZE }, (_, index) =>
      publishedRow(`guide-${index}`)
    );
    let rangeCalls = 0;
    const failure = new Error('transport down');
    const supabase = rejectingLinkedSupabase(() =>
      rangeCalls++ === 0
        ? Promise.resolve({ data: firstPage, error: null })
        : Promise.reject(failure)
    );
    const warnSpy = vi
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);

    try {
      const result = await getPublishedBlogPostSlugsForProducts(
        supabase,
        'merchant-1',
        [PRODUCT_ID]
      );

      expect(result).toHaveLength(PAGE_SIZE);
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('partial published-blog-post set'),
        expect.objectContaining({ merchantId: 'merchant-1', error: failure })
      );
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('resolves linked slugs and warns when only the category lookup fails', async () => {
    const { supabase } = makeSupabase(
      { data: [publishedRow('linked-guide')], error: null },
      { data: null, error: { message: 'category unavailable' } }
    );
    const warnSpy = vi
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);
    const errorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);

    try {
      const result = await getPublishedBlogPostSlugsForProducts(
        supabase as never,
        'merchant-1',
        ['123e4567-e89b-12d3-a456-426614174000'],
        ['smartphones']
      );

      expect(result).toEqual(['linked-guide']);
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('partial category-fallback'),
        expect.objectContaining({ merchantId: 'merchant-1' })
      );
      expect(errorSpy).not.toHaveBeenCalled();
    } finally {
      warnSpy.mockRestore();
      errorSpy.mockRestore();
    }
  });
});
