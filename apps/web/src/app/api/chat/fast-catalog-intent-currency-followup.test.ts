import { describe, expect, it } from 'vitest';
import { interpretFastCatalogIntent } from './fast-catalog-intent';

const categories = [
  { id: 'phones', name: 'Smartphones', slug: 'smartphones' },
  { id: 'accessories', name: 'Accessories', slug: 'accessories' },
  { id: 'laptops', name: 'Laptops', slug: 'laptops' },
];

describe('catalog budget corrections', () => {
  it('does not reuse an earlier naira budget after a foreign-currency follow-up', () => {
    expect(
      interpretFastCatalogIntent(
        ['Show me phones under 500k naira', 'Under 100 USD'],
        categories
      )
    ).toMatchObject({ kind: 'clarify' });
  });

  it('does not reuse an earlier budget after a malformed refinement', () => {
    expect(
      interpretFastCatalogIntent(
        ['Show me phones under 500k naira', 'Under 500,000ish'],
        categories
      )
    ).toMatchObject({ kind: 'clarify' });
  });

  it('accepts a corrected local budget after an unsupported currency', () => {
    expect(
      interpretFastCatalogIntent(
        ['Show Samsung phones under 500 USD', 'Under 500k naira'],
        categories,
        'NGN'
      )
    ).toMatchObject({
      kind: 'search',
      query: 'Samsung',
      maxPrice: 500_000,
    });
  });

  it.each([
    'ALL',
    'TOP',
  ])('keeps product context after correcting an earlier %s currency budget', (code) => {
    expect(
      interpretFastCatalogIntent(
        [`Show phones under 500 ${code} brands`, 'At most 500k naira'],
        categories,
        'NGN'
      )
    ).toMatchObject({
      kind: 'search',
      categoryId: 'phones',
      query: '',
      maxPrice: 500_000,
      exclusiveMaxPrice: false,
    });
  });

  it('does not interpret an unrelated amount-only reply as a budget', () => {
    expect(
      interpretFastCatalogIntent(
        ['Show iPhone 16', '500000'],
        categories,
        'NGN'
      )
    ).toBeNull();
  });

  it('does not guess whether a bare number after an invalid budget is a model or a price', () => {
    expect(
      interpretFastCatalogIntent(
        ['Show Samsung phones under 500 USD', '16'],
        categories,
        'NGN'
      )
    ).toBeNull();
  });

  it('accepts a corrected local budget after a malformed amount', () => {
    expect(
      interpretFastCatalogIntent(
        ['Show Samsung phones', 'Under 1.2.3k', 'Under 500k naira'],
        categories,
        'NGN'
      )
    ).toMatchObject({ kind: 'search', query: 'Samsung', maxPrice: 500_000 });
  });

  it.each([
    'What about a price under 500 USD?',
    'What about a price under 1.2.3k?',
  ])('retains the earlier brand after correcting an invalid price question: %s', (invalidPrice) => {
    expect(
      interpretFastCatalogIntent(
        ['Show Samsung phones', invalidPrice, 'Under 500k naira'],
        categories,
        'NGN'
      )
    ).toMatchObject({ kind: 'search', query: 'Samsung', maxPrice: 500_000 });
  });

  it('keeps a corrected budget through a later price question', () => {
    expect(
      interpretFastCatalogIntent(
        ['Show Samsung phones under 500 USD', 'Under 500k naira', 'Price?'],
        categories,
        'NGN'
      )
    ).toMatchObject({ kind: 'search', query: 'Samsung', maxPrice: 500_000 });
  });

  it.each([
    'Show phones within my budget',
    'Show phones under?',
  ])('accepts a numeric answer to an incomplete budget: %s', (initial) => {
    expect(
      interpretFastCatalogIntent(
        [initial, 'Under 500k naira'],
        categories,
        'NGN'
      )
    ).toMatchObject({ kind: 'search', query: '', maxPrice: 500_000 });
  });

  it('accepts an explicit correction in the same message', () => {
    expect(
      interpretFastCatalogIntent(
        ['Show Samsung phones under 500 USD, actually under 500k naira'],
        categories,
        'NGN'
      )
    ).toMatchObject({ kind: 'search', query: 'Samsung', maxPrice: 500_000 });
  });

  it('does not drop a prior range when the customer later adds a maximum', () => {
    expect(
      interpretFastCatalogIntent(
        ['Show phones between 100k and 500k', 'Under 300k naira'],
        categories,
        'NGN'
      )
    ).toMatchObject({ kind: 'clarify' });
  });
});
