import { describe, expect, it, vi } from 'vitest';
import { interpretFastCatalogIntent } from './fast-catalog-intent';
import { buildFastCatalogReply } from './fast-catalog-reply';

const categories = [
  { id: 'phones', name: 'Smartphones', slug: 'smartphones' },
  { id: 'laptops', name: 'Laptops', slug: 'laptops' },
  { id: 'accessories', name: 'Accessories', slug: 'accessories' },
  { id: 'earbuds', name: 'Earbuds', slug: 'earbuds' },
];

describe('catalog continuation requests', () => {
  it.each([
    'more',
    'Show me more',
    'More options?',
    'Show me more choices',
    'Other options?',
    'Show other options',
    'What else?',
    'Any others?',
  ])('gives honest no-card guidance for %s after a customer search', async (request) => {
    const load = vi.fn(async () => []);
    const result = await buildFastCatalogReply(
      ['Show me Samsung phones under 500k', request],
      categories,
      load,
      'NGN'
    );
    expect(result?.events).toEqual([]);
    expect(result?.text).toMatch(/can.t show another page.*(?:browse|refine)/i);
    expect(result?.text).not.toMatch(/no more|additional products available/i);
    expect(load).not.toHaveBeenCalled();
  });

  it('retains a customer product and latest budget after a continuation request', () => {
    expect(
      interpretFastCatalogIntent(
        ['Show me Samsung phones under 500k', 'Show me more', 'Under 300k'],
        categories,
        'NGN'
      )
    ).toMatchObject({
      kind: 'search',
      categoryId: 'phones',
      query: 'Samsung',
      maxPrice: 300_000,
      exclusiveMaxPrice: true,
    });
  });

  it('retains a budget supplied with a more-options request for a later refinement', async () => {
    const load = vi.fn(async () => []);
    const result = await buildFastCatalogReply(
      ['Show Samsung phones under 500k', 'Show me more under 300k'],
      categories,
      load,
      'NGN'
    );
    expect(result?.events).toEqual([]);
    expect(result?.text).toMatch(/can.t show another page/i);
    expect(load).not.toHaveBeenCalled();
    expect(
      interpretFastCatalogIntent(
        [
          'Show Samsung phones under 500k',
          'Show me more under 300k',
          'For gaming',
        ],
        categories,
        'NGN'
      )
    ).toMatchObject({
      kind: 'search',
      categoryId: 'phones',
      query: 'Samsung',
      maxPrice: 300_000,
      exclusiveMaxPrice: true,
      preference: 'gaming',
    });
  });

  it('retains a supported gaming condition from a continuation through a later budget', () => {
    expect(
      interpretFastCatalogIntent(
        ['Show Samsung phones under 500k', 'More for gaming', 'Under 300k'],
        categories,
        'NGN'
      )
    ).toMatchObject({
      kind: 'search',
      query: 'Samsung',
      maxPrice: 300_000,
      preference: 'gaming',
    });
  });

  it('retains a multiline continuation budget and preference on a later refinement', () => {
    expect(
      interpretFastCatalogIntent(
        [
          'Show Samsung phones under 500k',
          'Show me more under 300k\nfor gaming',
          'Under 250k',
        ],
        categories,
        'NGN'
      )
    ).toMatchObject({
      kind: 'search',
      categoryId: 'phones',
      query: 'Samsung',
      maxPrice: 250_000,
      preference: 'gaming',
    });
  });

  it.each([
    'More Samsung phones',
    'More iPhones',
    'More chargers',
  ])('asks for a complete fresh search instead of dropping constraints for %s', async (request) => {
    const load = vi.fn(async () => []);
    const result = await buildFastCatalogReply(
      ['Show Samsung phones under 500k', request],
      categories,
      load,
      'NGN'
    );
    expect(result?.events).toEqual([]);
    expect(result?.text).toMatch(/new search.*product.*budget/i);
    expect(result?.text).toMatch(/must.have conditions/i);
    expect(load).not.toHaveBeenCalled();
    expect(
      interpretFastCatalogIntent(
        ['Show Samsung phones under 500k', request, 'Under 300k'],
        categories,
        'NGN'
      )
    ).toMatchObject({ kind: 'clarify', reason: 'more-needs-search' });
  });

  it.each([
    ['More iPhones', 'iPhone 16'],
    ['More Samsung phones', 'Samsung phones'],
    ['More iPhones', 'Under 300k', 'iPhone 16'],
    ['More iPhones', 'iPhone 16', 'Under 300k'],
  ])('keeps the full-search clarification through incomplete replies: %j', (...replies) => {
    expect(
      interpretFastCatalogIntent(
        ['Show Samsung phones under 500k', ...replies],
        categories,
        'NGN'
      )
    ).toMatchObject({ kind: 'clarify', reason: 'more-needs-search' });
  });

  it('accepts a complete product-and-budget search after a continuation switch', () => {
    expect(
      interpretFastCatalogIntent(
        [
          'Show Samsung phones under 500k',
          'More iPhones',
          'Show iPhone 16 under 300k',
        ],
        categories,
        'NGN'
      )
    ).toMatchObject({ kind: 'search', query: 'iPhone 16', maxPrice: 300_000 });
  });

  it.each([
    'More under 300k for iPhone 16',
    'More for gaming iPhones',
    'More under 300k Samsung',
    'More Samsung S24',
  ])('asks for a fresh full search when more also names a product: %s', (request) => {
    expect(
      interpretFastCatalogIntent(
        ['Show Samsung phones under 500k', request, 'For gaming'],
        categories,
        'NGN'
      )
    ).toMatchObject({ kind: 'clarify', reason: 'more-needs-search' });
  });

  it('clarifies an unsupported currency even when it is part of a continuation', () => {
    expect(
      interpretFastCatalogIntent(
        ['Show Samsung phones under 500k', 'More under 500 USD'],
        categories,
        'NGN'
      )
    ).toMatchObject({ kind: 'clarify', reason: 'currency' });
  });

  it('retains accessory and device context through repeated continuation requests', () => {
    expect(
      interpretFastCatalogIntent(
        [
          'Show iPhone chargers under 10k',
          'Other options?',
          'More choices',
          'Under 5k',
        ],
        categories,
        'NGN'
      )
    ).toMatchObject({
      kind: 'search',
      categoryId: 'accessories',
      query: 'iPhone charger',
      isAccessory: true,
      maxPrice: 5_000,
    });
  });

  it('asks which product and detail the customer means by tell me more', async () => {
    const load = vi.fn(async () => []);
    const result = await buildFastCatalogReply(
      ['Show me Samsung phones', 'Tell me more'],
      categories,
      load
    );
    expect(result?.events).toEqual([]);
    expect(result?.text).toMatch(/which product.*(?:detail|know)/i);
    expect(load).not.toHaveBeenCalled();
  });

  it.each([
    'More storage',
    'More like iPhone 16',
    'More expensive',
  ])('does not mistake a meaningful constraint for pagination: %s', (request) => {
    expect(
      interpretFastCatalogIntent(['Show Samsung phones', request], categories)
    ).toMatchObject({ kind: 'clarify', reason: 'options' });
  });

  it.each([
    'More affordable?',
    'More than 500k',
  ])('does not treat relative-price or lower-bound wording as pagination: %s', (request) => {
    expect(
      interpretFastCatalogIntent(
        ['Show phones under 900k', request],
        categories
      )
    ).toMatchObject({ kind: 'clarify' });
  });

  it('starts a fresh search after a customer changes product', () => {
    expect(
      interpretFastCatalogIntent(
        [
          'Show Samsung phones under 500k',
          'Show me more',
          'Show laptops under 1m',
        ],
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
    ['Tell me a joke', 'Show me more'],
    ['Show Samsung phones', 'Cancel my order', 'More options'],
    ['Show Samsung phones', 'How do I pay?', 'More options'],
    ['Show Samsung phones', 'Tell me a joke', 'More options'],
  ])('does not cross unrelated or commerce boundaries: %j', (...messages) => {
    expect(interpretFastCatalogIntent(messages, categories)).toBeNull();
  });

  it('does not resurrect a product anchor beyond the bounded context window', () => {
    expect(
      interpretFastCatalogIntent(
        ['Show Samsung phones', 'more', 'more', 'more', 'more', 'more', 'more'],
        categories
      )
    ).toBeNull();
  });

  it('preserves More within an explicit named product', () => {
    expect(
      interpretFastCatalogIntent(['Show 1MORE earbuds'], categories)
    ).toMatchObject({ kind: 'search', query: '1MORE' });
  });
});
