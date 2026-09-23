import { describe, expect, it } from 'vitest';
import type { Product } from '@/lib/products';
import { findRelatedProducts } from './find-related-products';

function product(id: string, overrides: Partial<Product> = {}): Product {
  return {
    brand: overrides.brand ?? 'Unmatched',
    categories: overrides.categories ?? {
      id: 'category-1',
      name: 'Unmatched',
      slug: 'unmatched',
    },
    category: overrides.category ?? 'unmatched',
    category_slug: overrides.category_slug ?? 'unmatched',
    description: overrides.description ?? '',
    gtin: overrides.gtin ?? '',
    id: overrides.id ?? id,
    image: overrides.image ?? '/product.jpg',
    imageHint: overrides.imageHint ?? '',
    imageLarge: overrides.imageLarge ?? '/product.jpg',
    manage_stock: overrides.manage_stock ?? false,
    mpn: overrides.mpn ?? '',
    name: overrides.name ?? id,
    price: overrides.price ?? 100,
    slug: overrides.slug ?? id,
    status: overrides.status ?? 'active',
    stock: overrides.stock ?? 0,
    ...overrides,
  };
}

describe('findRelatedProducts', () => {
  it('ranks stronger category and brand matches first', () => {
    const current = product('current', {
      brand: 'Matched',
      category: 'phones',
    });
    const result = findRelatedProducts(
      current,
      [
        product('category-only', { category: 'phones', price: 200 }),
        product('strong', { brand: 'Matched', category: 'phones' }),
      ],
      2
    );

    expect(result.map(({ id }) => id)).toEqual(['strong', 'category-only']);
  });

  it('uses a deterministic codepoint fallback when every score is zero', () => {
    const current = product('current', {
      brand: 'Current Brand',
      category: 'current-category',
      price: 1_000,
    });
    const candidates = [
      product('z-id', { name: 'Zulu', price: 100 }),
      product('b-id', { name: 'Alpha', price: 100 }),
      product('a-id', { name: 'Alpha', price: 100 }),
    ];

    expect(
      findRelatedProducts(current, candidates, 3).map(({ id }) => id)
    ).toEqual(['a-id', 'b-id', 'z-id']);
    expect(
      findRelatedProducts(current, candidates, 3).map(({ id }) => id)
    ).toEqual(['a-id', 'b-id', 'z-id']);
  });

  it('handles a zero-priced current product without Infinity scoring', () => {
    const current = product('current', { price: 0, category: 'current' });
    const result = findRelatedProducts(
      current,
      [
        product('zero', { price: 0, category: 'other' }),
        product('paid', { price: 100, category: 'other' }),
      ],
      2
    );
    expect(result.map(({ id }) => id)).toEqual(['zero', 'paid']);
  });

  it('uses id as a deterministic tie-break when score and name match', () => {
    const current = product('current', { category: 'phones' });
    const result = findRelatedProducts(
      current,
      [
        product('z-id', { name: 'Same', category: 'phones' }),
        product('a-id', { name: 'Same', category: 'phones' }),
      ],
      3
    );

    expect(result.map(({ id }) => id)).toEqual(['a-id', 'z-id']);
  });
});
