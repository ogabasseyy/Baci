import { describe, expect, it } from 'vitest';
import { interpretFastCatalogIntent } from './fast-catalog-intent';

const categories = [
  { id: 'phones', name: 'Smartphones', slug: 'smartphones' },
  { id: 'accessories', name: 'Accessories', slug: 'accessories' },
  { id: 'laptops', name: 'Laptops', slug: 'laptops' },
];

describe('catalog budgets with naira currency labels', () => {
  it.each([
    ['Show me phones under 500,000 naira', 500_000, true],
    ['Show me phones under 500000naira', 500_000, true],
    ['Show me phones under500k naira', 500_000, true],
    ['Show me phones under 500k naira', 500_000, true],
    ['Show me phones under 500k ₦', 500_000, true],
    ['Show me phones at most 1 million NGN', 1_000_000, false],
    ['Show me phones under NGN 500k', 500_000, true],
    ['Show me phones under ₦500k', 500_000, true],
  ])('keeps currency labels out of the search for %s', (text, amount, exclusive) => {
    expect(interpretFastCatalogIntent([text], categories)).toMatchObject({
      kind: 'search',
      categoryId: 'phones',
      query: '',
      maxPrice: amount,
      exclusiveMaxPrice: exclusive,
    });
  });

  it('retains the accessory and latest budget in a naira follow-up', () => {
    expect(
      interpretFastCatalogIntent(
        ['Show me phone chargers', 'Under 20,000 naira', 'Under 10,000 naira'],
        categories
      )
    ).toMatchObject({
      kind: 'search',
      categoryId: 'accessories',
      query: 'charger',
      maxPrice: 10_000,
      exclusiveMaxPrice: true,
    });
  });

  it('keeps the word naira when it is not attached to a budget', () => {
    expect(
      interpretFastCatalogIntent(['Show me Naira phone'], categories)
    ).toMatchObject({ kind: 'search', query: 'Naira' });
    expect(
      interpretFastCatalogIntent(
        ['Show me Naira charger under 500k naira'],
        categories
      )
    ).toMatchObject({
      kind: 'search',
      query: 'Naira charger',
      maxPrice: 500_000,
    });
    expect(
      interpretFastCatalogIntent(
        ['Show me Dollar phones under 500k NGN'],
        categories
      )
    ).toMatchObject({ kind: 'search', query: 'Dollar', maxPrice: 500_000 });
  });

  it.each([
    'Show phones under 500k all brands',
    'Show phones under 500k naira all brands',
    'Show phones under 500k All brands',
    'Show phones under 500k all models',
  ])('keeps generic brand and model wording out of the query: %s', (text) => {
    expect(interpretFastCatalogIntent([text], categories, 'NGN')).toMatchObject(
      {
        kind: 'search',
        categoryId: 'phones',
        query: '',
        maxPrice: 500_000,
      }
    );
  });

  it('does not mistake a top-brand request for a foreign-currency conversion', () => {
    expect(
      interpretFastCatalogIntent(
        ['Show phones under 500k top brands'],
        categories,
        'NGN'
      )
    ).toMatchObject({ kind: 'clarify', reason: 'options' });
  });

  it('clarifies an uppercase top-brand request before the budget', () => {
    expect(
      interpretFastCatalogIntent(
        ['Show TOP BRANDS phones under 500k'],
        categories,
        'NGN'
      )
    ).toMatchObject({ kind: 'clarify', reason: 'options' });
  });

  it.each([
    'ALL',
    'TOP',
  ])('continues to clarify an explicit uppercase %s currency before brands', (code) => {
    expect(
      interpretFastCatalogIntent(
        [`Show phones under 500k ${code} brands`],
        categories,
        'NGN'
      )
    ).toMatchObject({ kind: 'clarify', reason: 'currency' });
  });

  it('preserves a specific brand when all-brand wording is also present', () => {
    expect(
      interpretFastCatalogIntent(
        ['Show Samsung phones under 500k all brands'],
        categories,
        'NGN'
      )
    ).toMatchObject({ kind: 'search', query: 'Samsung', maxPrice: 500_000 });
  });

  it('keeps a named Max model while consuming its separate naira budget', () => {
    expect(
      interpretFastCatalogIntent(
        ['Show me iPhone 16 Pro Max under 1.5 million naira'],
        categories
      )
    ).toMatchObject({
      kind: 'search',
      query: 'iPhone 16 Pro Max',
      maxPrice: 1_500_000,
      exclusiveMaxPrice: true,
    });
  });

  it('keeps the brand through a price refinement with a naira suffix', () => {
    expect(
      interpretFastCatalogIntent(
        [
          'Show Samsung phones under 1m naira',
          'What about a price under 500k naira?',
        ],
        categories
      )
    ).toMatchObject({
      kind: 'search',
      categoryId: 'phones',
      query: 'Samsung',
      maxPrice: 500_000,
    });
  });

  it.each([
    'Show me phones under $500',
    'Show me phones under USD 500',
    'Show me phones under 500 USD',
    'Show me phones under 500 dollars',
    'Show me phones below 500£',
    'Show me phones under 500 CAD',
    'Show me phones under 500 Usd',
    'Show me phones under 500 chf',
    'Show me phones under 500 nzd',
    'Show me phones under 500 hkd',
    'Show me phones under 500 vnd',
    'Show me phones under 500 rub',
    'Show me phones under 500 JPY',
    'Show me phones under 500 ¥',
    'Show me phones under 500 ₹',
    'Show me phones under?',
    'Show me phones under.',
    'Show me phones under:',
    'Show me phones under 1.2.3k',
    'Show me phones under 500,000ish',
    'Show me phones under 500 thousandish',
    'Show me phones under 1 millionish',
    'Show me phones under 500,00',
    'Show me phones under ,500',
    'Show me phones under 0 naira',
    'Show me phones under 1,000,000,000,001 naira',
  ])('asks for clarification for unsupported or malformed budgets: %s', (text) => {
    expect(interpretFastCatalogIntent([text], categories)).toMatchObject({
      kind: 'clarify',
    });
  });

  it('does not treat an explicit naira budget as another store currency', () => {
    expect(
      interpretFastCatalogIntent(
        ['Show me phones under 500k naira'],
        categories,
        'USD'
      )
    ).toMatchObject({ kind: 'clarify' });
  });

  it('accepts an explicit currency code when it matches the tenant currency', () => {
    expect(
      interpretFastCatalogIntent(
        ['Show me phones under 500 USD'],
        categories,
        'USD'
      )
    ).toMatchObject({
      kind: 'search',
      query: '',
      maxPrice: 500,
      exclusiveMaxPrice: true,
    });
    expect(
      interpretFastCatalogIntent(
        ['Show me phones under USD 500'],
        categories,
        'USD'
      )
    ).toMatchObject({
      kind: 'search',
      query: '',
      maxPrice: 500,
      exclusiveMaxPrice: true,
    });
  });

  it('starts a fresh search when the customer changes product category', () => {
    expect(
      interpretFastCatalogIntent(
        [
          'Show phones under 1m naira',
          'Under 500k naira',
          'Show laptops under 700k NGN',
        ],
        categories
      )
    ).toMatchObject({
      kind: 'search',
      categoryId: 'laptops',
      query: '',
      maxPrice: 700_000,
    });
  });
});
