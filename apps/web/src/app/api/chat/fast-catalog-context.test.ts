import { describe, expect, it } from 'vitest';
import { interpretFastCatalogIntent } from './fast-catalog-intent';

const categories = [
  { id: 'phones', name: 'Smartphones', slug: 'smartphones' },
  { id: 'laptops', name: 'Laptops', slug: 'laptops' },
  { id: 'accessories', name: 'Accessories', slug: 'accessories' },
];

describe('bounded catalog conversation context', () => {
  it('keeps the product category through repeated budget refinements', () => {
    expect(
      interpretFastCatalogIntent(
        ['Show me phones', 'Under 500k', 'Under 300k'],
        categories
      )
    ).toMatchObject({
      kind: 'search',
      categoryId: 'phones',
      query: '',
      maxPrice: 300_000,
    });
  });

  it('accepts budget refinements without spaces before the amount', () => {
    expect(
      interpretFastCatalogIntent(
        ['Show me phones', 'Under500k', 'Under300k'],
        categories
      )
    ).toMatchObject({
      kind: 'search',
      categoryId: 'phones',
      maxPrice: 300_000,
    });
  });

  it('does not interpret a negated compact budget as an upper limit', () => {
    expect(
      interpretFastCatalogIntent(
        ['Show me phones', 'Not under300k'],
        categories
      )
    ).toEqual({ kind: 'clarify', reason: 'options' });
  });

  it('keeps the original product when a budget refinement mentions price', () => {
    expect(
      interpretFastCatalogIntent(
        ['Show me iPhone 16', 'What about a price under 300k?'],
        categories
      )
    ).toMatchObject({ kind: 'search', query: 'iPhone 16', maxPrice: 300_000 });
  });

  it('keeps a named model and latest budget through a price follow-up', () => {
    expect(
      interpretFastCatalogIntent(
        ['Show me iPhone 16', 'Under 500k', 'Under 300k', 'How much?'],
        categories
      )
    ).toMatchObject({
      kind: 'search',
      categoryId: 'phones',
      query: 'iPhone 16',
      maxPrice: 300_000,
    });
  });

  it('retains the model through repeated price questions', () => {
    expect(
      interpretFastCatalogIntent(
        ['Show me iPhone 16', 'Under 500k', 'Price?', 'How much?'],
        categories
      )
    ).toMatchObject({ kind: 'search', query: 'iPhone 16', maxPrice: 500_000 });
  });

  it('asks which product when a price follow-up refers only to a category', () => {
    expect(
      interpretFastCatalogIntent(
        ['Show me phones', 'Under 500k', 'Under 300k', 'How much?'],
        categories
      )
    ).toEqual({ kind: 'clarify', reason: 'product' });
  });

  it('retains an accessory request across successive budgets', () => {
    expect(
      interpretFastCatalogIntent(
        ['Show me phone chargers', 'Under 20k', 'Under 10k'],
        categories
      )
    ).toMatchObject({
      kind: 'search',
      categoryId: 'accessories',
      query: 'charger',
      maxPrice: 10_000,
      isAccessory: true,
    });
  });

  it('retains a use-case refinement through a later budget', () => {
    expect(
      interpretFastCatalogIntent(
        ['Show me phones', 'With long battery life', 'Under 300k'],
        categories
      )
    ).toMatchObject({
      kind: 'search',
      categoryId: 'phones',
      query: '',
      preference: 'battery',
      maxPrice: 300_000,
    });
  });

  it('retains an explicit Wi-Fi-only restriction through later budgets', () => {
    expect(
      interpretFastCatalogIntent(
        ['Show me phones', 'Wi-Fi only', 'Under 500k', 'Under 300k'],
        categories
      )
    ).toMatchObject({
      kind: 'search',
      categoryId: 'phones',
      wifiOnly: true,
      maxPrice: 300_000,
    });
  });

  it('retains a later explicit Wi-Fi-only negation through a budget', () => {
    expect(
      interpretFastCatalogIntent(
        ['Show me phones', 'Wi-Fi only', 'Not Wi-Fi only', 'Under 300k'],
        categories
      )
    ).toMatchObject({
      kind: 'search',
      categoryId: 'phones',
      wifiOnly: false,
      maxPrice: 300_000,
    });
  });

  it('uses the latest Wi-Fi-only instruction when the customer changes it', () => {
    expect(
      interpretFastCatalogIntent(
        ['Show me phones', 'Not Wi-Fi only', 'Wi-Fi only', 'Under 300k'],
        categories
      )
    ).toMatchObject({ kind: 'search', wifiOnly: true, maxPrice: 300_000 });
  });

  it('accepts a natural-language budget refinement', () => {
    expect(
      interpretFastCatalogIntent(
        ['Show me phones', 'My budget is 300k'],
        categories
      )
    ).toMatchObject({ kind: 'search', query: '', maxPrice: 300_000 });
  });

  it.each([
    'Anything cheaper?',
    'Something less expensive?',
    'Any more affordable options?',
  ])('asks for a concrete budget on a relative-price follow-up: %s', (followUp) => {
    expect(
      interpretFastCatalogIntent(
        ['Show me phones under 500k', followUp],
        categories
      )
    ).toEqual({ kind: 'clarify' });
  });

  it('uses an explicit new budget after an earlier relative-price question', () => {
    expect(
      interpretFastCatalogIntent(
        ['Show me phones', 'Anything cheaper?', 'Under 300k'],
        categories
      )
    ).toMatchObject({
      kind: 'search',
      query: '',
      categoryId: 'phones',
      maxPrice: 300_000,
    });
  });

  it('uses a concrete budget stated with the relative-price request', () => {
    expect(
      interpretFastCatalogIntent(
        ['Show me iPhone 16', 'Anything cheaper under 300k'],
        categories
      )
    ).toMatchObject({ kind: 'search', query: 'iPhone 16', maxPrice: 300_000 });
  });

  it('retains a product model named Max with separate budget refinements', () => {
    expect(
      interpretFastCatalogIntent(
        ['Show me AirPods Max 2', 'Under 500k', 'At most 300k'],
        categories
      )
    ).toMatchObject({
      kind: 'search',
      query: 'AirPods Max 2',
      maxPrice: 300_000,
      exclusiveMaxPrice: false,
    });
  });

  it.each([
    'Within 500k',
    'Max 500k',
    'Up to 500k',
  ])('recognizes a supported budget refinement: %s', (budget) => {
    expect(
      interpretFastCatalogIntent(['Show me phones', budget], categories)
    ).toMatchObject({
      kind: 'search',
      categoryId: 'phones',
      maxPrice: 500_000,
    });
  });

  it('uses the last budget in a correction within one message', () => {
    expect(
      interpretFastCatalogIntent(
        ['iPhone 16 under 900k', 'under 500k, actually under 300k'],
        categories
      )
    ).toMatchObject({ kind: 'search', query: 'iPhone 16', maxPrice: 300_000 });
  });

  it('starts a new product search without carrying the old category or budget', () => {
    expect(
      interpretFastCatalogIntent(
        ['Show phones under 500k', 'Under 300k', 'Show laptops under 1m'],
        categories
      )
    ).toMatchObject({
      kind: 'search',
      categoryId: 'laptops',
      query: '',
      maxPrice: 1_000_000,
    });
  });

  it.each([
    ['Show me phones', 'How do I pay?', 'Under 300k'],
    ['Show me phones', 'Thanks for your help', 'Under 300k'],
  ])('does not reuse product context across an unrelated message', (...messages) => {
    expect(interpretFastCatalogIntent(messages, categories)).toBeNull();
  });

  it('clarifies a negated limit rather than treating it as an upper bound', () => {
    expect(
      interpretFastCatalogIntent(
        ['Show me phones', 'Not under 300k'],
        categories
      )
    ).toEqual({ kind: 'clarify', reason: 'options' });
  });

  it('does not silently keep an older budget when the new limit is unspecified', () => {
    expect(
      interpretFastCatalogIntent(
        ['Show phones under 500k', 'Under'],
        categories
      )
    ).toMatchObject({ kind: 'clarify' });
  });

  it('retains unsupported earlier product options as a clarification', () => {
    expect(
      interpretFastCatalogIntent(
        ['Show used phones', 'Under 500k', 'Under 300k'],
        categories
      )
    ).toEqual({ kind: 'clarify', reason: 'options' });
  });
});
