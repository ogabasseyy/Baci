import { describe, expect, it } from 'vitest';
import {
  buildStorefrontProductPurgeUrls,
  countDistinctProductPurgeEntries,
  resolveProductPurgeCategorySegment,
  resolveProductPurgeCategorySegmentForRow,
} from './storefront-product-purge-urls';

describe('resolveProductPurgeCategorySegment', () => {
  it('derives the category segment from a legacy text category', () => {
    expect(
      resolveProductPurgeCategorySegment({
        slug: 'iphone-15',
        name: 'iPhone 15',
        category: 'Smartphones',
      })
    ).toBe('smartphones');
  });

  it('prefers the joined category slug (direct category resolution)', () => {
    expect(
      resolveProductPurgeCategorySegment({
        slug: 'rog-ally',
        name: 'ROG Ally',
        category: 'Ignored Legacy Text',
        categories: { name: 'Gaming', slug: 'Gaming-Laptops' },
      })
    ).toBe('gaming-laptops');
  });

  it('uses category_slug when no joined category is present', () => {
    expect(
      resolveProductPurgeCategorySegment({
        slug: 'ipad-air',
        name: 'iPad Air',
        category_slug: 'Tablets',
      })
    ).toBe('tablets');
  });

  it('prefers the joined category slug over both category_slug and legacy text', () => {
    // Full PR #2914 precedence: direct category_id join wins over the
    // category_slug and the legacy text column, so the purge targets the same
    // canonical the storefront serves.
    expect(
      resolveProductPurgeCategorySegment({
        slug: 'rog-ally',
        name: 'ROG Ally',
        category: 'Legacy Text',
        category_slug: 'legacy-slug',
        categories: { name: 'Gaming', slug: 'gaming-laptops' },
      })
    ).toBe('gaming-laptops');
  });

  it('returns null when the product resolves to the /products/<slug> fallback', () => {
    expect(
      resolveProductPurgeCategorySegment({
        slug: 'mystery-box',
        name: 'Mystery Box',
        category: null,
      })
    ).toBeNull();
  });

  it('returns null for a missing/blank slug', () => {
    expect(
      resolveProductPurgeCategorySegment({ slug: '   ', category: 'Audio' })
    ).toBeNull();
  });
});

describe('resolveProductPurgeCategorySegmentForRow', () => {
  it('prefers the direct category_id join (object embed)', () => {
    expect(
      resolveProductPurgeCategorySegmentForRow({
        slug: 'rog-ally',
        category: 'Legacy Text',
        categories: { slug: 'gaming-laptops' },
        product_categories: [{ categories: { slug: 'junction-cat' } }],
      })
    ).toBe('gaming-laptops');
  });

  it('normalizes an array-shaped direct join embed', () => {
    expect(
      resolveProductPurgeCategorySegmentForRow({
        slug: 'rog-ally',
        categories: [{ slug: 'gaming-laptops' }],
      })
    ).toBe('gaming-laptops');
  });

  it('uses the active junction over legacy text when there is no direct join', () => {
    // Precedence: direct join → active junction → legacy text. This keeps
    // cache eviction aligned with the PDP snapshot after a direct category is
    // retired.
    const input = {
      slug: 'ipad-air',
      category: 'Tablets',
      categories: null,
      product_categories: [{ categories: { slug: 'junction-cat' } }],
    };

    const result = resolveProductPurgeCategorySegmentForRow(input);

    expect(result).toBe('junction-cat');
  });

  it('ignores an inactive direct category and selects the lowest active junction id', () => {
    const input = {
      slug: 'pixel-6-pro',
      category: 'Legacy Category',
      categories: { is_active: false, slug: 'retired-category' },
      product_categories: [
        {
          category_id: 'category-0',
          categories: {
            is_active: false,
            slug: 'inactive-category',
          },
        },
        {
          category_id: 'category-z',
          categories: { is_active: true, slug: 'z-category' },
        },
        {
          category_id: 'category-a',
          categories: { is_active: true, slug: 'a-category' },
        },
      ],
    };

    const result = resolveProductPurgeCategorySegmentForRow(input);

    expect(result).toBe('a-category');
  });

  it('falls back to the junction when there is NO direct join and NO legacy text', () => {
    // This is the F1 gap: a product assigned only via the junction still
    // canonicalizes under the junction category, so its segment must resolve.
    expect(
      resolveProductPurgeCategorySegmentForRow({
        slug: 'usb-c-cable',
        category: null,
        categories: null,
        product_categories: [{ categories: { slug: 'accessories' } }],
      })
    ).toBe('accessories');
  });

  it('normalizes an array-shaped junction category embed', () => {
    expect(
      resolveProductPurgeCategorySegmentForRow({
        slug: 'usb-c-cable',
        product_categories: [{ categories: [{ slug: 'accessories' }] }],
      })
    ).toBe('accessories');
  });

  it('returns null (the /products fallback) when nothing resolves a category', () => {
    expect(
      resolveProductPurgeCategorySegmentForRow({
        slug: 'mystery-box',
        category: null,
        categories: null,
        product_categories: [],
      })
    ).toBeNull();
  });

  it('resolves the join segment for a legacy null-slug row via the id fallback', () => {
    // A null-slug row stays addressable at `/products/<id>` and `/<category>/<id>`.
    // Without the id fallback the null slug short-circuits to null and the
    // categorized PDP + category listing are dropped from the purge.
    expect(
      resolveProductPurgeCategorySegmentForRow({
        id: 'prod-legacy-1',
        slug: null,
        categories: { slug: 'accessories' },
      })
    ).toBe('accessories');
  });

  it('resolves the junction segment for a null-slug row with no direct join', () => {
    expect(
      resolveProductPurgeCategorySegmentForRow({
        id: 'prod-legacy-2',
        slug: '  ',
        category: null,
        categories: null,
        product_categories: [{ categories: { slug: 'audio' } }],
      })
    ).toBe('audio');
  });
});

describe('countDistinctProductPurgeEntries', () => {
  it('counts repeated rows for one product as a single distinct target', () => {
    // 60 duplicate rows of ONE product must not trip a distinct-count threshold
    // of 50: they collapse to a single (slug, segment) purge target.
    const entries = Array.from({ length: 60 }, () => ({
      slug: 'iphone-15',
      categorySegment: 'smartphones',
    }));

    expect(countDistinctProductPurgeEntries(entries)).toBe(1);
    expect(countDistinctProductPurgeEntries(entries) > 50).toBe(false);
  });

  it('counts each distinct (slug, segment) pair', () => {
    const entries = Array.from({ length: 60 }, (_, index) => ({
      slug: `product-${index}`,
      categorySegment: 'smartphones',
    }));

    expect(countDistinctProductPurgeEntries(entries)).toBe(60);
    expect(countDistinctProductPurgeEntries(entries) > 50).toBe(true);
  });

  it('ignores blank slugs and dedupes by the exact case-sensitive pair', () => {
    expect(
      countDistinctProductPurgeEntries([
        { slug: '  ' },
        { slug: 'iphone-15', categorySegment: 'smartphones' },
        { slug: 'iphone-15', categorySegment: 'smartphones' },
        { slug: 'iphone-15', categorySegment: 'Smartphones' },
      ])
    ).toBe(2);
  });
});

describe('buildStorefrontProductPurgeUrls', () => {
  it('emits canonical PDP, fallback PDP, category listing, and home per hostname', () => {
    const urls = buildStorefrontProductPurgeUrls(
      ['ogabassey'],
      [{ slug: 'iphone-15', categorySegment: 'smartphones' }]
    );

    expect(urls).toEqual([
      'https://ogabassey.com/',
      'https://ogabassey.com/products',
      'https://ogabassey.com/smartphones/iphone-15',
      'https://ogabassey.com/products/iphone-15',
      'https://ogabassey.com/smartphones',
      'https://www.ogabassey.com/',
      'https://www.ogabassey.com/products',
      'https://www.ogabassey.com/smartphones/iphone-15',
      'https://www.ogabassey.com/products/iphone-15',
      'https://www.ogabassey.com/smartphones',
    ]);
  });

  it('emits the /products listing once per hostname for every product mutation', () => {
    const urls = buildStorefrontProductPurgeUrls(
      ['ogabassey'],
      [{ slug: 'iphone-15', categorySegment: 'smartphones' }]
    );

    // The all-products listing is a cacheable public document, so it must be
    // evicted (exactly once per hostname) on any product change.
    expect(
      urls.filter((url) => url === 'https://ogabassey.com/products')
    ).toEqual(['https://ogabassey.com/products']);
    expect(urls).toContain('https://www.ogabassey.com/products');
  });

  it('emits only the fallback PDP, products listing, and home when the category is unknown', () => {
    const urls = buildStorefrontProductPurgeUrls(
      ['ogabassey'],
      [{ slug: 'mystery-box', categorySegment: null }]
    );

    expect(urls).toEqual([
      'https://ogabassey.com/',
      'https://ogabassey.com/products',
      'https://ogabassey.com/products/mystery-box',
      'https://www.ogabassey.com/',
      'https://www.ogabassey.com/products',
      'https://www.ogabassey.com/products/mystery-box',
    ]);
  });

  it('emits one listing per distinct category across multiple products', () => {
    const urls = buildStorefrontProductPurgeUrls(
      ['ogabassey.com'],
      [
        { slug: 'iphone-15', categorySegment: 'smartphones' },
        { slug: 'galaxy-s24', categorySegment: 'smartphones' },
        { slug: 'ipad-air', categorySegment: 'tablets' },
      ]
    );

    // The two smartphones collapse to a single /smartphones listing; each PDP
    // (canonical + fallback) is still emitted.
    expect(urls).toEqual([
      'https://ogabassey.com/',
      'https://ogabassey.com/products',
      'https://ogabassey.com/smartphones/iphone-15',
      'https://ogabassey.com/products/iphone-15',
      'https://ogabassey.com/smartphones/galaxy-s24',
      'https://ogabassey.com/products/galaxy-s24',
      'https://ogabassey.com/tablets/ipad-air',
      'https://ogabassey.com/products/ipad-air',
      'https://ogabassey.com/smartphones',
      'https://ogabassey.com/tablets',
      'https://www.ogabassey.com/',
      'https://www.ogabassey.com/products',
      'https://www.ogabassey.com/smartphones/iphone-15',
      'https://www.ogabassey.com/products/iphone-15',
      'https://www.ogabassey.com/smartphones/galaxy-s24',
      'https://www.ogabassey.com/products/galaxy-s24',
      'https://www.ogabassey.com/tablets/ipad-air',
      'https://www.ogabassey.com/products/ipad-air',
      'https://www.ogabassey.com/smartphones',
      'https://www.ogabassey.com/tablets',
    ]);
  });

  it('preserves original slug and category casing (CDN paths are case-sensitive)', () => {
    const urls = buildStorefrontProductPurgeUrls(
      ['ogabassey'],
      [{ slug: 'IPhone-15', categorySegment: 'Smartphones' }]
    );

    expect(urls).toEqual([
      'https://ogabassey.com/',
      'https://ogabassey.com/products',
      'https://ogabassey.com/Smartphones/IPhone-15',
      'https://ogabassey.com/products/IPhone-15',
      'https://ogabassey.com/Smartphones',
      'https://www.ogabassey.com/',
      'https://www.ogabassey.com/products',
      'https://www.ogabassey.com/Smartphones/IPhone-15',
      'https://www.ogabassey.com/products/IPhone-15',
      'https://www.ogabassey.com/Smartphones',
    ]);
  });

  it('keeps case-only-distinct entries (distinct CDN cache keys) and drops blanks and exact duplicates', () => {
    const urls = buildStorefrontProductPurgeUrls(
      ['ogabassey', 'ogabassey.com'],
      [
        { slug: 'iphone-15', categorySegment: 'smartphones' },
        { slug: 'IPHONE-15', categorySegment: 'SMARTPHONES' },
        { slug: 'iphone-15', categorySegment: 'smartphones' },
        { slug: '   ', categorySegment: 'smartphones' },
      ]
    );

    // CDN paths are case-sensitive: a case-only rename means the old and new
    // URLs are two distinct cached entries, so BOTH must be purged. Exact
    // duplicates and blank slugs are dropped.
    expect(urls).toEqual([
      'https://ogabassey.com/',
      'https://ogabassey.com/products',
      'https://ogabassey.com/smartphones/iphone-15',
      'https://ogabassey.com/products/iphone-15',
      'https://ogabassey.com/SMARTPHONES/IPHONE-15',
      'https://ogabassey.com/products/IPHONE-15',
      'https://ogabassey.com/smartphones',
      'https://ogabassey.com/SMARTPHONES',
      'https://www.ogabassey.com/',
      'https://www.ogabassey.com/products',
      'https://www.ogabassey.com/smartphones/iphone-15',
      'https://www.ogabassey.com/products/iphone-15',
      'https://www.ogabassey.com/SMARTPHONES/IPHONE-15',
      'https://www.ogabassey.com/products/IPHONE-15',
      'https://www.ogabassey.com/smartphones',
      'https://www.ogabassey.com/SMARTPHONES',
    ]);
  });

  it('returns an empty list for storefronts without a public cache policy', () => {
    expect(
      buildStorefrontProductPurgeUrls('unknown-store'.split(','), [
        { slug: 'iphone-15', categorySegment: 'smartphones' },
      ])
    ).toEqual([]);
  });

  it('returns an empty list when there are no identifiers', () => {
    expect(
      buildStorefrontProductPurgeUrls([], [{ slug: 'iphone-15' }])
    ).toEqual([]);
  });

  it('returns an empty list when there are no entries', () => {
    expect(buildStorefrontProductPurgeUrls(['ogabassey'], [])).toEqual([]);
  });

  it('returns an empty list when every entry has a blank slug', () => {
    expect(
      buildStorefrontProductPurgeUrls(['ogabassey'], [{ slug: '  ' }])
    ).toEqual([]);
  });

  it('keeps every PDP URL in a high-cardinality batch', () => {
    const entries = Array.from({ length: 51 }, (_, index) => ({
      slug: `product-${index}`,
      categorySegment: 'smartphones',
    }));
    const urls = buildStorefrontProductPurgeUrls(['ogabassey'], entries);

    expect(urls).toEqual(
      expect.arrayContaining([
        'https://ogabassey.com/smartphones/product-0',
        'https://ogabassey.com/products/product-0',
        'https://ogabassey.com/smartphones/product-50',
        'https://ogabassey.com/products/product-50',
        'https://www.ogabassey.com/smartphones/product-50',
        'https://www.ogabassey.com/products/product-50',
      ])
    );
  });
});
