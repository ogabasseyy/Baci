import { describe, expect, it, vi } from 'vitest';
import { fetchLinkedBlogPostRows } from './fetch-linked-blog-post-rows';

const UUID = (index: number) =>
  `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`;

function row(slug: string) {
  return {
    blog_posts: {
      slug,
      status: 'published',
      published_at: '2026-08-31T00:00:00Z',
    },
  };
}

function client(
  rangeImpl: () => Promise<{ data: unknown; error: unknown }>,
  onIn?: (values: string[]) => void
) {
  const builder: Record<string, unknown> = {};
  builder.eq = vi.fn(() => builder);
  builder.not = vi.fn(() => builder);
  builder.order = vi.fn(() => builder);
  builder.in = vi.fn((_column: string, values: string[]) => {
    onIn?.(values);
    return builder;
  });
  builder.range = vi.fn(rangeImpl);
  return { from: vi.fn(() => ({ select: vi.fn(() => builder) })) } as never;
}

describe('fetchLinkedBlogPostRows', () => {
  it('chunks product ids and returns the preserved rows without an error', async () => {
    const inCalls: string[][] = [];
    const supabase = client(
      () => Promise.resolve({ data: [row('a')], error: null }),
      (values) => inCalls.push(values)
    );

    const result = await fetchLinkedBlogPostRows(
      supabase,
      'merchant-1',
      Array.from({ length: 250 }, (_, index) => UUID(index))
    );

    expect(result.lastError).toBeNull();
    expect(result.rows).toHaveLength(3);
    expect(inCalls).toHaveLength(3);
    expect(inCalls.every((values) => values.length <= 100)).toBe(true);
  });

  it('continues later chunks and reports the last error with partial rows', async () => {
    let rangeCalls = 0;
    const failure = new Error('first chunk unavailable');
    const supabase = client(() => {
      rangeCalls += 1;
      return Promise.resolve(
        rangeCalls === 1
          ? { data: null, error: failure }
          : { data: [row('later-linked-guide')], error: null }
      );
    });

    const result = await fetchLinkedBlogPostRows(
      supabase,
      'merchant-1',
      Array.from({ length: 300 }, (_, index) => UUID(index))
    );

    expect(rangeCalls).toBe(3);
    expect(result.lastError).toBe(failure);
    expect(result.rows).toHaveLength(2);
  });
});
