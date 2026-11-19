import { describe, expect, it } from 'vitest';
import { interpretFastCatalogIntent } from './fast-catalog-intent';

const categories = [
  { id: 'phones', name: 'Smartphones', slug: 'smartphones' },
  { id: 'laptops', name: 'Laptops', slug: 'laptops' },
  { id: 'earbuds', name: 'Earbuds', slug: 'earbuds' },
];

describe('Max product names and budgets', () => {
  it.each([
    ['Do you have iPhone 16 Pro Max?', 'iPhone 16 Pro Max'],
    ['Do you have iPhone XS Max?', 'iPhone XS Max'],
    ['Do you have AirPods Max?', 'AirPods Max'],
    ['Do you have AirPods Max 2?', 'AirPods Max 2'],
    ['Do you have MacBook Pro M4 Max?', 'MacBook Pro M4 Max'],
    ['Do you have Redmi Note 17 Pro Max?', 'Redmi Note 17 Pro Max'],
    ['Do you have HP Omen Max 16T-AH000?', 'HP Omen Max 16T-AH000'],
    ['Do you have Hollyland Lark Max 2?', 'Hollyland Lark Max 2'],
  ])('searches %s as a product name', (question, query) => {
    expect(interpretFastCatalogIntent([question], categories)).toMatchObject({
      kind: 'search',
      query,
    });
  });

  it('keeps a Max model and applies a separate maximum price', () => {
    expect(
      interpretFastCatalogIntent(['iPhone 16 Pro Max under 500k'], categories)
    ).toMatchObject({
      kind: 'search',
      query: 'iPhone 16 Pro Max',
      maxPrice: 500_000,
    });
  });

  it('recognizes a separate max budget after a Max accessory model', () => {
    expect(
      interpretFastCatalogIntent(['AirPods Max max 500k'], categories)
    ).toMatchObject({
      kind: 'search',
      query: 'AirPods Max',
      maxPrice: 500_000,
    });
  });

  it('continues to parse max as a budget for other products', () => {
    expect(
      interpretFastCatalogIntent(['Show me phones max 500k'], categories)
    ).toMatchObject({ kind: 'search', maxPrice: 500_000 });
  });

  it.each([
    'Show me phones for students max 500k',
    'Find an iPhone for photography max 500k',
  ])('keeps the max budget after a use case: %s', (question) => {
    expect(interpretFastCatalogIntent([question], categories)).toMatchObject({
      kind: 'search',
      maxPrice: 500_000,
    });
  });

  it.each([
    'Do you have iPhone 15 max ₦500k?',
    'Show me AirPods Max 300,000',
    'Do you have Hollyland Lark Max 50k?',
    'Do you have AirPods Max N500?',
  ])('asks about an ambiguous Max model or budget: %s', (question) => {
    expect(interpretFastCatalogIntent([question], categories)).toEqual({
      kind: 'clarify',
      reason: 'max-budget',
    });
  });

  it('still asks for an unspecified maximum budget', () => {
    expect(
      interpretFastCatalogIntent(['Show me phones with max budget'], categories)
    ).toEqual({ kind: 'clarify' });
  });
});
