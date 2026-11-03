import { describe, expect, it, vi } from 'vitest';
import { interpretFastCatalogIntent } from './fast-catalog-intent';
import { buildFastCatalogReply } from './fast-catalog-reply';

const categories = [{ id: 'phones', name: 'Smartphones', slug: 'smartphones' }];

describe('ambiguous currency words in a budget', () => {
  it.each([
    'Show phones under 500k try Samsung',
    'Show phones under 500k pen',
    'Show phones under 500k mop',
    'Show phones under 500k rub',
    'Show phones under 500k NGN pen',
    'Show phones under 500k all',
    'Show phones under 500k top rated',
    'Show phones under 500k all colours',
  ])('asks for a fresh full request without a catalog search: %s', async (text) => {
    const load = vi.fn(async () => []);
    const result = await buildFastCatalogReply([text], categories, load, 'NGN');
    expect(result?.text).toMatch(/currency.*part of.*product request/i);
    expect(result?.text).toMatch(/new message.*product.*budget/i);
    expect(load).not.toHaveBeenCalled();
  });

  it('keeps the ambiguity when only a corrected budget follows', () => {
    expect(
      interpretFastCatalogIntent(
        ['Show phones under 500k pen', 'Under 300k naira'],
        categories,
        'NGN'
      )
    ).toMatchObject({ kind: 'clarify', reason: 'ambiguous-budget' });
  });

  it.each([
    '500pen',
    '500pEn',
    '500try',
    '500rub',
    '500mop',
    '500kpen',
    '500,000pen',
    '500pen,',
    '500pen.',
    '500millionpen',
    '500thousandtry',
  ])('keeps attached ambiguous code text %s across corrections', (amount) => {
    const initial = `Show phones under ${amount}`;
    expect(
      interpretFastCatalogIntent([initial], categories, 'NGN')
    ).toMatchObject({
      kind: 'clarify',
      reason: 'ambiguous-budget',
    });
    expect(
      interpretFastCatalogIntent(
        [initial, 'Under 300k naira'],
        categories,
        'NGN'
      )
    ).toMatchObject({ kind: 'clarify', reason: 'ambiguous-budget' });
    expect(
      interpretFastCatalogIntent(
        [`${initial} actually under 300k naira`],
        categories,
        'NGN'
      )
    ).toMatchObject({ kind: 'clarify', reason: 'ambiguous-budget' });
  });

  it.each([
    '500penalty',
    '500xpen',
  ])('does not misidentify a longer malformed suffix %s as the PEN code', (amount) => {
    expect(
      interpretFastCatalogIntent(
        [`Show phones under ${amount}`, 'Under 300k naira'],
        categories,
        'NGN'
      )
    ).toMatchObject({ kind: 'search', maxPrice: 300_000 });
  });

  it('allows a fresh product-and-budget request to resolve the ambiguity', () => {
    expect(
      interpretFastCatalogIntent(
        [
          'Show phones under 500k pen',
          'Show Samsung phones at most 300k naira',
        ],
        categories,
        'NGN'
      )
    ).toMatchObject({ kind: 'search', query: 'Samsung', maxPrice: 300_000 });
  });

  it('keeps product words that precede the budget', () => {
    expect(
      interpretFastCatalogIntent(
        ['Show pen phones under 500k naira'],
        categories,
        'NGN'
      )
    ).toMatchObject({ kind: 'search', query: 'pen', maxPrice: 500_000 });
  });

  it.each([
    'ALL',
    'TOP',
    'TRY',
    'chf',
  ])('keeps explicit %s currency as a currency clarification', (code) => {
    expect(
      interpretFastCatalogIntent(
        [`Show phones under 500 ${code}`],
        categories,
        'NGN'
      )
    ).toMatchObject({ kind: 'clarify', reason: 'currency' });
  });
});
