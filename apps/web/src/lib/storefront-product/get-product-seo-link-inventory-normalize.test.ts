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
});

describe('toProductSemanticCandidate', () => {
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
