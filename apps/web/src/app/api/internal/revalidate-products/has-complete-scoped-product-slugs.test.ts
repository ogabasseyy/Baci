import { describe, expect, it } from 'vitest';
import { hasCompleteScopedProductSlugs } from './has-complete-scoped-product-slugs';

describe('hasCompleteScopedProductSlugs', () => {
  it('returns true regardless of entry ordering when every id-only entry maps in authoritativeSlugsById', () => {
    expect(
      hasCompleteScopedProductSlugs(
        [{ id: 'prod-1' }, { slug: 'galaxy-s25' }],
        [
          { slug: 'galaxy-s25', categorySegment: null },
          { slug: 'iphone-15', categorySegment: 'smartphones' },
        ],
        ['galaxy-s25', 'iphone-15', 'prod-1'],
        new Map([['prod-1', 'iphone-15']])
      )
    ).toBe(true);
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
});
