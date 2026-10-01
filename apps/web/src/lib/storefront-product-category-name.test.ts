import { describe, expect, it } from 'vitest';
import {
  resolveMappedStorefrontProductCategorySlug,
  resolveStorefrontProductCategoryName,
  resolveStorefrontProductCategorySlug,
  resolveSupportedStorefrontProductCategoryRelation,
} from './storefront-product-category-name';

describe('resolveStorefrontProductCategoryName', () => {
  it('prefers a joined category name, then its slug, before stale legacy text', () => {
    expect(
      resolveStorefrontProductCategoryName({
        categories: { name: 'Action Cameras', slug: 'action-cameras' },
        category: 'Smartphones',
      })
    ).toBe('Action Cameras');

    expect(
      resolveStorefrontProductCategoryName({
        categories: { slug: 'action-cameras' },
        category: 'Smartphones',
      })
    ).toBe('action-cameras');
  });

  it('uses canonical category_slug before stale legacy text when the join is missing', () => {
    expect(
      resolveStorefrontProductCategoryName({
        categories: null,
        category_slug: 'action-cameras',
        category: 'Smartphones',
      })
    ).toBe('action-cameras');
  });
  it('skips unsupported joined names before using a relation-backed slug', () => {
    expect(
      resolveStorefrontProductCategoryName({
        categories: { name: 'Unknown', slug: 'action-cameras' },
        category: 'Smartphones',
      })
    ).toBe('action-cameras');
  });

  it('skips unsupported joined slugs before using the canonical slug', () => {
    expect(
      resolveStorefrontProductCategoryName({
        categories: { slug: 'unknown' },
        category_slug: 'action-cameras',
        category: 'Smartphones',
      })
    ).toBe('action-cameras');
  });

  it('skips unsupported canonical slugs before using legacy category text', () => {
    expect(
      resolveStorefrontProductCategoryName({
        category_slug: 'unknown',
        category: 'Action Cameras',
      })
    ).toBe('Action Cameras');
  });

  it('skips placeholder legacy category text when relation metadata is absent', () => {
    expect(
      resolveStorefrontProductCategoryName({
        category: 'Unknown',
      })
    ).toBeNull();
  });
});

describe('resolveStorefrontProductCategorySlug', () => {
  it('prefers a supported joined slug before legacy category text', () => {
    expect(
      resolveStorefrontProductCategorySlug({
        categories: { slug: 'action-cameras' },
        category: 'Smartphones',
      })
    ).toBe('action-cameras');
  });

  it('skips placeholder joined slugs before using legacy category text', () => {
    expect(
      resolveStorefrontProductCategorySlug({
        categories: { slug: 'unknown' },
        category: 'Action Cameras',
      })
    ).toBe('Action Cameras');
  });
});

describe('resolveMappedStorefrontProductCategorySlug', () => {
  it('preserves authoritative joined slugs without re-slugifying them', () => {
    expect(
      resolveMappedStorefrontProductCategorySlug({
        categories: { slug: 'smart?watches#gps' },
        category: 'Smart Watches',
      })
    ).toBe('smart?watches#gps');
  });

  it('slugifies display-text fallbacks when no authoritative slug exists', () => {
    expect(
      resolveMappedStorefrontProductCategorySlug({
        categories: { name: 'Action Cameras' },
        category: 'Smartphones',
      })
    ).toBe('action-cameras');
  });
});

describe('resolveSupportedStorefrontProductCategoryRelation', () => {
  it('skips placeholder category rows before selecting a supported relation', () => {
    expect(
      resolveSupportedStorefrontProductCategoryRelation([
        { slug: 'unknown' },
        { slug: 'action-cameras' },
      ])
    ).toEqual({ slug: 'action-cameras' });
  });
});
