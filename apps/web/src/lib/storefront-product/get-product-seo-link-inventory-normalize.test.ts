import { describe, expect, it, vi } from 'vitest';
import {
  getProductSeoSelect,
  mergeProductCandidates,
  toProductSemanticCandidate,
} from './get-product-seo-link-inventory-normalize';

vi.mock('@/lib/product-key-specs-select', () => ({
  PRODUCT_KEY_SPECS_RELATION_SELECT: 'product_key_specs',
}));

describe('getProductSeoSelect', () => {
  it('includes stable recency data for globally merging category scopes', () => {
    expect(getProductSeoSelect(false)).toContain('created_at');
  });

  it('includes manage_stock in category-scoped and unscoped select strings', () => {
    expect(getProductSeoSelect(false)).toContain('manage_stock');
    expect(getProductSeoSelect(true)).toContain('manage_stock');
  });

  it('includes has_condition_offers in category-scoped and unscoped select strings', () => {
    expect(getProductSeoSelect(false)).toContain('has_condition_offers');
    expect(getProductSeoSelect(true)).toContain('has_condition_offers');
  });
});

describe('toProductSemanticCandidate', () => {
  it('preserves has_condition_offers when present on product row', () => {
    const candidate = toProductSemanticCandidate(
      {
        slug: 'macbook-pro',
        name: 'MacBook Pro',
        price: 1500,
        has_condition_offers: true,
      },
      'fallback'
    );
    expect(candidate?.has_condition_offers).toBe(true);
  });
  it('normalizes numeric string prices and prefers the direct category slug', () => {
    const candidate = toProductSemanticCandidate(
      {
        slug: 'macbook-pro',
        name: 'MacBook Pro',
        price: '1,500',
        stock: 0,
        stock_quantity: 3,
        categories: { slug: 'laptops' },
        product_categories: [{ categories: { slug: 'secondary' } }],
        product_key_specs: [{ ram: '16GB' }],
      },
      'fallback'
    );

    expect(candidate).toEqual(
      expect.objectContaining({
        slug: 'macbook-pro',
        price: 1500,
        stock: 3,
        category_slug: 'laptops',
        product_key_specs: { ram: '16GB' },
      })
    );
  });

  it('prefers a joined category slug that matches the requested scoped category', () => {
    const candidate = toProductSemanticCandidate(
      {
        slug: 'legion-5',
        name: 'Legion 5',
        price: 1500,
        categories: { slug: 'laptops' },
        product_categories: [{ categories: { slug: 'gaming-laptops' } }],
      },
      'gaming-laptops'
    );

    expect(candidate).toEqual(
      expect.objectContaining({
        slug: 'legion-5',
        category_slug: 'gaming-laptops',
      })
    );
  });

  it('falls back to id for slug-less products to preserve raw pool index and price-band membership', () => {
    const candidate = toProductSemanticCandidate(
      {
        id: 'prod-123',
        slug: '',
        name: 'Slugless Phone',
        price: 1500,
      },
      'fallback'
    );
    expect(candidate).toEqual(
      expect.objectContaining({
        id: 'prod-123',
        slug: 'prod-123',
        has_explicit_slug: false,
      })
    );
  });

  it('returns null for rows without crawlable product identity or finite price', () => {
    expect(
      toProductSemanticCandidate(
        { slug: '', name: 'MacBook Pro', price: 1500 },
        'fallback'
      )
    ).toBeNull();
    expect(
      toProductSemanticCandidate(
        { slug: 'macbook-pro', name: 'MacBook Pro', price: 'free' },
        'fallback'
      )
    ).toBeNull();
    expect(
      toProductSemanticCandidate(
        { slug: 'macbook-pro', name: 'MacBook Pro', price: '' },
        'fallback'
      )
    ).toBeNull();
    expect(
      toProductSemanticCandidate(
        { slug: 'macbook-pro', name: 'MacBook Pro', price: '   ' },
        'fallback'
      )
    ).toBeNull();
  });

  describe('manage_stock candidate stock resolution', () => {
    it.each([
      {
        label: 'unmanaged with false and 0 stock',
        product: {
          slug: 'unmanaged-false',
          name: 'Unmanaged False',
          price: 100,
          manage_stock: false,
          stock: 0,
          stock_quantity: 0,
        },
        expectedStock: null,
        expectedManageStock: false,
      },
      {
        label: 'managed with null and 0 stock',
        product: {
          slug: 'managed-null',
          name: 'Managed Null',
          price: 100,
          manage_stock: null,
          stock: 0,
          stock_quantity: 0,
        },
        expectedStock: 0,
        expectedManageStock: null,
      },
      {
        label: 'tracked zero stock with true',
        product: {
          slug: 'tracked-zero',
          name: 'Tracked Zero',
          price: 100,
          manage_stock: true,
          stock: 0,
          stock_quantity: 0,
        },
        expectedStock: 0,
        expectedManageStock: true,
      },
      {
        label: 'tracked positive stock with true',
        product: {
          slug: 'tracked-positive',
          name: 'Tracked Positive',
          price: 100,
          manage_stock: true,
          stock: 0,
          stock_quantity: 6,
        },
        expectedStock: 6,
        expectedManageStock: true,
      },
      {
        label:
          'omitted manage_stock with zero stock (strict projection fallback)',
        product: {
          slug: 'omitted-zero',
          name: 'Omitted Zero',
          price: 100,
          stock: 0,
          stock_quantity: 0,
        },
        expectedStock: 0,
        expectedManageStock: undefined,
      },
      {
        label: 'omitted manage_stock with positive stock',
        product: {
          slug: 'omitted-positive',
          name: 'Omitted Positive',
          price: 100,
          stock: 0,
          stock_quantity: 9,
        },
        expectedStock: 9,
        expectedManageStock: undefined,
      },
      {
        label:
          'legacy positive stock with zero stock_quantity and manage_stock true',
        product: {
          slug: 'legacy-positive',
          name: 'Legacy Positive',
          price: 100,
          manage_stock: true,
          stock: 8,
          stock_quantity: 0,
        },
        expectedStock: 8,
        expectedManageStock: true,
      },
    ])('resolves candidate stock for $label', ({
      product,
      expectedStock,
      expectedManageStock,
    }) => {
      const candidate = toProductSemanticCandidate(product, 'fallback');
      expect(candidate).not.toBeNull();
      expect(candidate?.stock).toBe(expectedStock);
      expect(candidate?.manage_stock).toBe(expectedManageStock);
    });
  });

  it('deduplicates semantic candidates by slug in source order', () => {
    expect(
      mergeProductCandidates([
        { slug: 'macbook-pro', name: 'MacBook Pro', price: 1500 },
        { slug: 'macbook-pro', name: 'Duplicate', price: 1400 },
        { slug: 'thinkpad', name: 'ThinkPad', price: 900 },
      ])
    ).toEqual([
      { slug: 'macbook-pro', name: 'MacBook Pro', price: 1500 },
      { slug: 'thinkpad', name: 'ThinkPad', price: 900 },
    ]);
  });
});
