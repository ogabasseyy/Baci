import { describe, expect, it } from 'vitest';
import { hasCompleteScopedProductSlugs } from './has-complete-scoped-product-slugs';

describe('hasCompleteScopedProductSlugs', () => {
  it('requires non-empty previousSlug by default and accepts id-only or null previousSlug only with allowAssumedUnchangedSlugs', () => {
    const entries = [
      { slug: 'galaxy-s25', categorySegment: null },
      { slug: 'iphone-15', categorySegment: 'smartphones' },
    ];
    const resolvedSlugs = ['galaxy-s25', 'iphone-15', 'prod-1'];
    const authoritative = new Map([
      ['prod-1', 'iphone-15'],
      ['prod-2', 'galaxy-s25'],
    ]);

    expect(
      hasCompleteScopedProductSlugs(
        [
          { id: 'prod-1' },
          { id: 'prod-2', slug: 'galaxy-s25', previousSlug: null },
        ],
        entries,
        resolvedSlugs,
        authoritative
      )
    ).toBe(false);

    expect(
      hasCompleteScopedProductSlugs(
        [
          { id: 'prod-1' },
          { id: 'prod-2', slug: 'galaxy-s25', previousSlug: null },
        ],
        entries,
        resolvedSlugs,
        authoritative,
        { allowAssumedUnchangedSlugs: true }
      )
    ).toBe(true);
  });

  it('returns false for slug-only product entries without an authoritative id', () => {
    expect(
      hasCompleteScopedProductSlugs(
        [{ slug: 'galaxy-s25' }],
        [{ slug: 'galaxy-s25', categorySegment: null }],
        ['galaxy-s25'],
        new Map()
      )
    ).toBe(false);
  });

  it('returns false when an id-only product is missing from authoritativeSlugsById even with extra entries', () => {
    expect(
      hasCompleteScopedProductSlugs(
        [{ id: 'prod-1' }, { id: 'prod-archived' }],
        [
          { slug: 'iphone-15', categorySegment: 'smartphones' },
          { slug: 'extra-category-slug', categorySegment: 'phones' },
          { slug: 'prod-archived', categorySegment: null },
        ],
        ['iphone-15', 'extra-category-slug', 'prod-1', 'prod-archived'],
        new Map([['prod-1', 'iphone-15']])
      )
    ).toBe(false);
  });

  it('returns false when entries or resolvedSlugs are incomplete', () => {
    expect(hasCompleteScopedProductSlugs([{ id: 'prod-1' }], [], [])).toBe(
      false
    );
    expect(
      hasCompleteScopedProductSlugs(
        [{ slug: 'iphone-15' }],
        [{ slug: 'iphone-15', categorySegment: null }],
        []
      )
    ).toBe(false);
  });

  it('requires an authoritative row and non-empty previousSlug when a product provides id and slug', () => {
    expect(
      hasCompleteScopedProductSlugs(
        [{ id: 'prod-1', slug: 'iphone-15', previousSlug: 'iphone-14' }],
        [
          { slug: 'iphone-15', categorySegment: 'smartphones' },
          { slug: 'iphone-14', categorySegment: 'smartphones' },
        ],
        ['iphone-15', 'iphone-14', 'prod-1'],
        new Map()
      )
    ).toBe(false);

    expect(
      hasCompleteScopedProductSlugs(
        [{ id: 'prod-1', slug: 'iphone-15' }],
        [{ slug: 'iphone-15', categorySegment: 'smartphones' }],
        ['iphone-15', 'prod-1'],
        new Map([['prod-1', 'iphone-15']])
      )
    ).toBe(false);

    expect(
      hasCompleteScopedProductSlugs(
        [{ id: 'prod-1', slug: 'iphone-15', previousSlug: null }],
        [{ slug: 'iphone-15', categorySegment: 'smartphones' }],
        ['iphone-15', 'prod-1'],
        new Map([['prod-1', 'iphone-15']])
      )
    ).toBe(false);

    expect(
      hasCompleteScopedProductSlugs(
        [{ id: 'prod-1', slug: 'iPhone-15', previousSlug: 'iPhone-14' }],
        [
          { slug: 'iphone-15', categorySegment: 'smartphones' },
          { slug: 'iphone-14', categorySegment: 'smartphones' },
        ],
        ['iphone-15', 'iphone-14', 'prod-1'],
        new Map([['prod-1', 'iphone-15']])
      )
    ).toBe(true);
  });

  it('rejects permuted id-to-slug pairings even when the slug multiset matches', () => {
    expect(
      hasCompleteScopedProductSlugs(
        [
          { id: 'prod-1', slug: 'galaxy-s25', previousSlug: 'galaxy-s24' },
          { id: 'prod-2', slug: 'iphone-15', previousSlug: 'iphone-14' },
        ],
        [
          { slug: 'galaxy-s24', categorySegment: 'smartphones' },
          { slug: 'iphone-14', categorySegment: 'smartphones' },
          { slug: 'iphone-15', categorySegment: 'smartphones' },
          { slug: 'galaxy-s25', categorySegment: 'smartphones' },
        ],
        ['iphone-15', 'galaxy-s25', 'prod-1', 'prod-2'],
        new Map([
          ['prod-1', 'iphone-15'],
          ['prod-2', 'galaxy-s25'],
        ])
      )
    ).toBe(false);
  });

  it('checks optional previousSlug in entries and resolvedSlugs and falls back when legacy caller slug differs from authoritative slug', () => {
    expect(
      hasCompleteScopedProductSlugs(
        [{ id: 'prod-1', slug: 'iphone-16', previousSlug: 'iphone-15' }],
        [
          { slug: 'iphone-16', categorySegment: 'smartphones' },
          { slug: 'iphone-15', categorySegment: 'smartphones' },
        ],
        ['iphone-16', 'iphone-15', 'prod-1'],
        new Map([['prod-1', 'iphone-16']])
      )
    ).toBe(true);

    expect(
      hasCompleteScopedProductSlugs(
        [{ id: 'prod-1', slug: 'iphone-16', previousSlug: 'iphone-15' }],
        [{ slug: 'iphone-16', categorySegment: 'smartphones' }],
        ['iphone-16', 'iphone-15', 'prod-1'],
        new Map([['prod-1', 'iphone-16']])
      )
    ).toBe(false);

    expect(
      hasCompleteScopedProductSlugs(
        [{ id: 'prod-1', slug: 'iphone-16', previousSlug: 'iphone-15' }],
        [{ slug: 'iphone-16', categorySegment: 'smartphones' }],
        ['iphone-16', 'prod-1'],
        new Map([['prod-1', 'iphone-16']])
      )
    ).toBe(false);

    expect(
      hasCompleteScopedProductSlugs(
        [{ id: 'prod-1', slug: 'iphone-15' }],
        [{ slug: 'iphone-15', categorySegment: 'smartphones' }],
        ['iphone-16', 'iphone-15', 'prod-1'],
        new Map([['prod-1', 'iphone-16']])
      )
    ).toBe(false);
  });
});
