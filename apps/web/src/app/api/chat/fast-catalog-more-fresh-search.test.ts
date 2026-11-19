import { describe, expect, it } from 'vitest';
import { interpretFastCatalogIntent } from './fast-catalog-intent';

const categories = [
  { id: 'phones', name: 'Smartphones', slug: 'smartphones' },
  { id: 'accessories', name: 'Accessories', slug: 'accessories' },
  { id: 'earbuds', name: 'Earbuds', slug: 'earbuds' },
];

describe('pending complete search after a more-options product switch', () => {
  it.each([
    ['More iPhones', 'iPhone 16', 'iPhone 15'],
    ['More iPhones', 'iPhone 16', 'Under 300k', 'iPhone 15'],
    ['More iPhones', 'iPhone 16 under 500 USD', 'iPhone 15'],
    ['More iPhones', 'iPhone 16 under 300k with 256GB', 'iPhone 15'],
    ['More iPhones', 'iPhone 16 under 300k more than 100k', 'iPhone 15'],
  ])('does not lose the previous budget through incomplete replies: %j', (...replies) => {
    expect(
      interpretFastCatalogIntent(
        ['Show Samsung phones under 500k', ...replies],
        categories,
        'NGN'
      )
    ).toMatchObject({ kind: 'clarify', reason: 'more-needs-search' });
  });

  it('accepts a later complete search with a valid explicit budget', () => {
    expect(
      interpretFastCatalogIntent(
        [
          'Show Samsung phones under 500k',
          'More iPhones',
          'iPhone 16',
          'Show iPhone 15 under 300k',
        ],
        categories,
        'NGN'
      )
    ).toMatchObject({ kind: 'search', query: 'iPhone 15', maxPrice: 300_000 });
  });

  it('accepts a valid category-only product and budget after a switch', () => {
    expect(
      interpretFastCatalogIntent(
        ['Show Samsung phones under 500k', 'More iPhones', 'Phones under 300k'],
        categories,
        'NGN'
      )
    ).toMatchObject({
      kind: 'search',
      categoryId: 'phones',
      query: '',
      maxPrice: 300_000,
    });
  });

  it('does not clear pending clarification for a category-rejected option', () => {
    expect(
      interpretFastCatalogIntent(
        [
          'Show Samsung phones under 500k',
          'More earbuds',
          'Earbuds under 20k without wireless',
          'Earbuds',
        ],
        categories,
        'NGN'
      )
    ).toMatchObject({ kind: 'clarify', reason: 'more-needs-search' });
  });

  it.each([
    'More options like iPhone 16',
    'More options affordable',
    'More options expensive',
    'More options storage',
  ])('does not turn a wrapped condition into a model query: %s', (request) => {
    expect(
      interpretFastCatalogIntent(
        ['Show Samsung phones under 500k', request],
        categories,
        'NGN'
      )
    ).toMatchObject({ kind: 'clarify', reason: 'more-needs-search' });
  });
});
