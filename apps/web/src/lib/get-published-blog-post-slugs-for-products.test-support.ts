import { vi } from 'vitest';

export function makeSupabase(
  result: { data: unknown; error: unknown },
  categoryResult: { data: unknown; error: unknown } = { data: [], error: null },
  canonicalCategoryResult: { data: unknown; error: unknown } = categoryResult
) {
  const inSpy = vi.fn();
  const categoryInSpy = vi.fn();
  const categoryOrSpy = vi.fn();
  const categoryRangeSpy = vi.fn();
  const linkedRangeSpy = vi.fn();
  let categoryQuery: 'exact' | 'canonical' = 'exact';
  const categoryPages = {
    exact: [] as Array<{ data: unknown; error: unknown }>,
    canonical: [] as Array<{ data: unknown; error: unknown }>,
  };
  const linkedPages: Array<{ data: unknown; error: unknown }> = [];
  const productBuilder = {
    eq: vi.fn(() => productBuilder),
    not: vi.fn(() => productBuilder),
    in: vi.fn((column: string, values: string[]) => {
      inSpy(column, values);
      return productBuilder;
    }),
    order: vi.fn(() => productBuilder),
    range: vi.fn((from: number, to: number) => {
      linkedRangeSpy(from, to);
      const page = Math.floor(from / 256);
      return Promise.resolve(
        linkedPages[page] ?? (page === 0 ? result : { data: [], error: null })
      );
    }),
  };
  const categoryBuilder = {
    eq: vi.fn(() => categoryBuilder),
    in: vi.fn((column: string, values: string[]) => {
      categoryInSpy(column, values);
      categoryQuery = 'exact';
      return categoryBuilder;
    }),
    or: vi.fn((filter: string) => {
      categoryOrSpy(filter);
      categoryQuery = 'canonical';
      return categoryBuilder;
    }),
    range: vi.fn((from: number, to: number) => {
      categoryRangeSpy(from, to);
      const page = Math.floor(from / 256);
      const configuredPages = categoryPages[categoryQuery];
      return Promise.resolve(
        configuredPages[page] ??
          (page === 0
            ? categoryQuery === 'canonical'
              ? canonicalCategoryResult
              : categoryResult
            : { data: [], error: null })
      );
    }),
    order: vi.fn(() => categoryBuilder),
  };
  const supabase = {
    from: vi.fn((table: string) => ({
      select: vi.fn(() =>
        table === 'blog_posts' ? categoryBuilder : productBuilder
      ),
    })),
  };
  return {
    categoryInSpy,
    categoryPages,
    categoryRangeSpy,
    categoryOrSpy,
    inSpy,
    linkedPages,
    linkedRangeSpy,
    supabase,
  };
}
