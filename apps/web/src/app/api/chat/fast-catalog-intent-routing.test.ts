import { describe, expect, it } from 'vitest';
import { interpretFastCatalogIntent } from './fast-catalog-intent';

const categories = [
  { id: 'phones', name: 'Smartphones', slug: 'smartphones' },
  { id: 'accessories', name: 'Accessories', slug: 'accessories' },
];

describe('catalog intent routing and use-case constraints', () => {
  it.each([
    'What is your phone number?',
    "What's your phone no.?",
    'What is the store telephone number?',
    "What's Ogabassey's number?",
    'How can I contact you?',
    'How can I call you?',
  ])('does not search the catalog for contact information: %s', (message) => {
    expect(interpretFastCatalogIntent([message], categories)).toBeNull();
  });

  it.each([
    ['Show me phones with long battery life', '', 'battery'],
    ['Phones with good battery life', '', 'battery'],
    ['Phones with a long-lasting battery', '', 'battery'],
    ['Samsung phones with long battery life', 'Samsung', 'battery'],
    ['Show phones with good camera quality', '', 'camera'],
    ['Phones for heavy gaming', '', 'gaming'],
  ])('separates a use case from model terms: %s', (message, query, preference) => {
    expect(interpretFastCatalogIntent([message], categories)).toMatchObject({
      kind: 'search',
      categoryId: 'phones',
      query,
      preference,
    });
  });

  it('retains a named model and budget alongside a use case', () => {
    expect(
      interpretFastCatalogIntent(
        ['iPhone 16 Pro Max with long battery life under 500k'],
        categories
      )
    ).toMatchObject({
      kind: 'search',
      query: 'iPhone 16 Pro Max',
      maxPrice: 500_000,
      preference: 'battery',
    });
  });

  it('keeps battery as a charger constraint instead of a recommendation tag', () => {
    const result = interpretFastCatalogIntent(
      ['Show me battery chargers'],
      categories
    );
    expect(result).toMatchObject({
      kind: 'search',
      categoryId: 'accessories',
      query: 'battery charger',
      isAccessory: true,
    });
    expect(result).not.toHaveProperty('preference');
  });

  it.each([
    'Phones with a 5000 mAh battery',
    'Phones with 5000mAh battery life',
    'Phones with a 48 MP camera',
    'Phones with a 48-megapixel camera',
    'Phones with 20 hours of battery life',
    'A phone with a battery that lasts all day',
    'A phone with a good low-light camera',
  ])('clarifies an unverified specification: %s', (message) => {
    expect(interpretFastCatalogIntent([message], categories)).toEqual({
      kind: 'clarify',
      reason: 'options',
    });
  });

  it('does not discard excluded or multiple use cases', () => {
    for (const message of [
      'Phones without good battery life',
      'Phones with long battery life and good camera quality',
    ]) {
      expect(interpretFastCatalogIntent([message], categories)).toEqual({
        kind: 'clarify',
        reason: 'options',
      });
    }
  });
});
