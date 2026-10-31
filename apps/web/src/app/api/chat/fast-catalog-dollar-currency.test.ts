import { describe, expect, it } from 'vitest';
import { analyzeFastCatalogBudget } from './fast-catalog-budget';
import { interpretFastCatalogIntent } from './fast-catalog-intent';

const categories = [{ id: 'phones', name: 'Smartphones', slug: 'smartphones' }];

describe('dollar-denominated catalog budgets', () => {
  it.each([
    'budget $500-$1000',
    'budget $500 – $1000',
    'budget $500-$1000 under $900',
  ])('clarifies unsupported ranges: %s', (budget) => {
    expect(
      interpretFastCatalogIntent(
        [`Show Samsung phones ${budget}`],
        categories,
        'USD'
      )
    ).toMatchObject({ kind: 'clarify' });
  });
  it.each([
    ['Show Samsung phones under $500', 500, true],
    ['Show Samsung phones at most $500 USD', 500, false],
    ['Show Samsung phones below 500$', 500, true],
    ['Show Samsung phones under $500 in USD', 500, true],
    ['Show Samsung phones under $500, USD', 500, true],
    ['Show Samsung phones under $500 (USD)', 500, true],
    ['Show Samsung phones under $500 in stock', 500, true],
    ['Show Samsung phones under $500 USD in stock', 500, true],
    ['Show Samsung phones under $500 USD for gaming', 500, true],
  ])('uses a dollar limit only for a USD store: %s', (text, amount, exclusive) => {
    expect(interpretFastCatalogIntent([text], categories, 'USD')).toMatchObject(
      {
        kind: 'search',
        categoryId: 'phones',
        query: 'Samsung',
        maxPrice: amount,
        exclusiveMaxPrice: exclusive,
      }
    );
  });

  it.each([
    'NGN',
    'CAD',
  ])('clarifies a dollar limit for a %s store', (currency) => {
    expect(
      interpretFastCatalogIntent(
        ['Show Samsung phones under $500'],
        categories,
        currency
      )
    ).toMatchObject({ kind: 'clarify', reason: 'currency' });
  });

  it('clarifies when the store currency is unknown', () => {
    expect(
      interpretFastCatalogIntent(['Show Samsung phones under $500'], categories)
    ).toMatchObject({ kind: 'clarify', reason: 'currency' });
  });

  it.each([
    'Show Samsung phones under $500 CAD',
    'Show Samsung phones under $500 NGN',
    'Show Samsung phones under CAD $500',
    'Show Samsung phones under US$500',
    'Show Samsung phones under $500 in CAD',
    'Show Samsung phones under $500, CAD',
    'Show Samsung phones under $500 (CAD)',
    'Show Samsung phones under $500 in NGN',
    'Show Samsung phones under $500 [CAD]',
    'Show Samsung phones under $500 - CAD',
    'Show Samsung phones under $500 / CAD',
    'Show Samsung phones under $500 Canadian dollars',
    'Show Samsung phones under $500 C$',
    'Show Samsung phones under $500 (CAD',
    'Show Samsung phones under $500 USD CAD',
    'Show Samsung phones under $500 USD in CAD',
    'Show Samsung phones under $500 USD (CAD)',
    'Show Samsung phones under $500 USD USD USD USD CAD',
    'Show Samsung phones under $500 – CAD',
    'Show Samsung phones under $500 — CAD',
    'Show Samsung phones under $500. CAD',
    'Show Samsung phones under $500 USD . CAD',
    'Show Samsung phones under $500 CA$',
    'Show Samsung phones under $500 NZ dollars',
    'Show Samsung phones under $500 Aussie dollars',
    'Show Samsung phones under $500 Mexican dollars',
    'Show Samsung phones under $500 converted to CAD',
    'Show Samsung phones under $500 denominated in CAD',
    'Show Samsung phones under $500 in pesos',
    'Show Samsung phones under $500 priced in CAD',
    'Show Samsung phones under $500 payable in CAD',
    'Show Samsung phones under $500 charged in CAD',
    'Show Samsung phones under $500 quoted in CAD',
    'Show Samsung phones under $500 listed in CAD',
  ])('clarifies an explicitly conflicting currency: %s', (text) => {
    expect(interpretFastCatalogIntent([text], categories, 'USD')).toMatchObject(
      {
        kind: 'clarify',
      }
    );
  });

  it('retains the product and latest dollar budget through a follow-up', () => {
    expect(
      interpretFastCatalogIntent(
        ['Show Samsung phones under $500', 'At most $300'],
        categories,
        'USD'
      )
    ).toMatchObject({
      kind: 'search',
      categoryId: 'phones',
      query: 'Samsung',
      maxPrice: 300,
      exclusiveMaxPrice: false,
    });
  });

  it('accepts a later explicit USD correction without retaining a conflicting qualifier', () => {
    expect(
      interpretFastCatalogIntent(
        ['Show Samsung phones under $500 in CAD', 'At most $300'],
        categories,
        'USD'
      )
    ).toMatchObject({
      kind: 'search',
      categoryId: 'phones',
      query: 'Samsung',
      maxPrice: 300,
      exclusiveMaxPrice: false,
    });
  });

  it('fails closed on an excessively spaced suffix', () => {
    const result = analyzeFastCatalogBudget(
      `under $500${' '.repeat(50_000)}CAD`,
      'USD'
    );
    expect(result.invalid).toBe(true);
  }, 10_000);

  it.each([
    ['Show Samsung phones under $500 USD USD USD USD CAD', 'Under $300'],
    ['Show Samsung phones under $500 (CAD', 'Under $300'],
    [`Show Samsung phones under $500${' '.repeat(65)}CAD`, 'Under $300'],
    ['Show Samsung phones under $500 converted to CAD', 'Under $300'],
    ['Show Samsung phones under $500 priced in CAD', 'Under $300'],
    ['Show Samsung phones under $500 (CAD, actually under $300'],
  ])('requires a fresh search after an unconsumed currency suffix', (...messages) => {
    expect(
      interpretFastCatalogIntent(messages, categories, 'USD')
    ).toMatchObject({
      kind: 'clarify',
    });
  });

  it('does not silently turn a Max model into a price cue', () => {
    expect(
      interpretFastCatalogIntent(['iPhone 16 Pro Max $500'], categories, 'USD')
    ).toMatchObject({ kind: 'clarify' });
  });
});
