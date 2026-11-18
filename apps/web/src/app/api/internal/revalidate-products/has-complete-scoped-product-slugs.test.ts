import { describe, expect, it } from 'vitest';
import { hasCompleteScopedProductSlugs } from './has-complete-scoped-product-slugs';

describe('hasCompleteScopedProductSlugs', () => {
  it('returns true regardless of entry ordering when every entry resolves authoritatively by id', () => {
    expect(
      hasCompleteScopedProductSlugs(
        [{ id: 'prod-1' }, { id: 'prod-2', slug: 'galaxy-s25' }],
        [
          { slug: 'galaxy-s25', categorySegment: null },
          { slug: 'iphone-15', categorySegment: 'smartphones' },
        ],
        ['galaxy-s25', 'iphone-15', 'prod-1'],
        new Map([
          ['prod-1', 'iphone-15'],
          ['prod-2', 'galaxy-s25'],
        ])
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

  it('requires an authoritative row when a product provides both id and slug', () => {
    expect(
      hasCompleteScopedProductSlugs(
        [{ id: 'prod-1', slug: 'iphone-15' }],
        [{ slug: 'iphone-15', categorySegment: 'smartphones' }],
        ['iphone-15', 'prod-1'],
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
    ).toBe(true);
  });
});
