import { describe, expect, it, vi } from 'vitest';
import { getPublishedBlogPostSlugsForProducts } from './get-published-blog-post-slugs-for-products';

const UUID = (index: number) =>
  `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`;

describe('getPublishedBlogPostSlugsForProducts product-id chunking', () => {
  it('keeps linked-post requests bounded near the revalidation contract limit', async () => {
    const inCalls: string[][] = [];
    const rows = [
      {
        blog_posts: {
          slug: 'linked-guide',
          status: 'published',
          published_at: '2026-08-31T00:00:00Z',
        },
      },
    ];
    const builder: Record<string, unknown> = {};
    builder.eq = vi.fn(() => builder);
    builder.not = vi.fn(() => builder);
    builder.order = vi.fn(() => builder);
    builder.in = vi.fn((_column: string, values: string[]) => {
      inCalls.push(values);
      return builder;
    });
    builder.range = vi.fn(() => Promise.resolve({ data: rows, error: null }));
    const supabase = {
      from: vi.fn(() => ({ select: vi.fn(() => builder) })),
    };

    const result = await getPublishedBlogPostSlugsForProducts(
      supabase as never,
      'merchant-1',
      Array.from({ length: 1000 }, (_, index) => UUID(index))
    );

    expect(result).toEqual(['linked-guide']);
    expect(inCalls).toHaveLength(10);
    expect(inCalls.every((values) => values.length <= 100)).toBe(true);
    expect(inCalls[0]).toHaveLength(100);
    expect(inCalls[9]).toHaveLength(100);
  });

  it('continues with later product chunks after an earlier relationship read fails', async () => {
    let rangeCalls = 0;
    const laterRows = [
      {
        blog_posts: {
          slug: 'later-linked-guide',
          status: 'published',
          published_at: '2026-08-31T00:00:00Z',
        },
      },
    ];
    const builder: Record<string, unknown> = {};
    builder.eq = vi.fn(() => builder);
    builder.not = vi.fn(() => builder);
    builder.order = vi.fn(() => builder);
    builder.in = vi.fn(() => builder);
    builder.range = vi.fn(() => {
      rangeCalls += 1;
      return Promise.resolve(
        rangeCalls === 1
          ? { data: null, error: new Error('first chunk unavailable') }
          : { data: laterRows, error: null }
      );
    });
    const supabase = {
      from: vi.fn(() => ({ select: vi.fn(() => builder) })),
    };

    const result = await getPublishedBlogPostSlugsForProducts(
      supabase as never,
      'merchant-1',
      Array.from({ length: 300 }, (_, index) => UUID(index))
    );

    expect(result).toEqual(['later-linked-guide']);
    expect(rangeCalls).toBe(3);
  });
});
