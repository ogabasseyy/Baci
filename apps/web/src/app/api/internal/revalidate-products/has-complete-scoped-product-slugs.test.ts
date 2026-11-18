import { describe, expect, it } from 'vitest';
import { hasCompleteScopedProductSlugs } from './has-complete-scoped-product-slugs';

describe('hasCompleteScopedProductSlugs', () => {
  it('returns true when every supplied product resolves to a non-id slug', () => {
    expect(
      hasCompleteScopedProductSlugs(
        [{ id: 'prod-1' }, { slug: 'galaxy-s25' }],
        [
          { slug: 'iphone-15', categorySegment: 'smartphones' },
          { slug: 'galaxy-s25', categorySegment: null },
        ],
        ['iphone-15', 'prod-1', 'galaxy-s25']
      )
    ).toBe(true);
  });

  it('returns false when an id-only entry falls back to its raw id', () => {
    expect(
      hasCompleteScopedProductSlugs(
        [{ id: 'prod-1' }, { id: 'prod-archived' }],
        [
          { slug: 'iphone-15', categorySegment: 'smartphones' },
          { slug: 'prod-archived', categorySegment: null },
        ],
        ['iphone-15', 'prod-1', 'prod-archived']
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
