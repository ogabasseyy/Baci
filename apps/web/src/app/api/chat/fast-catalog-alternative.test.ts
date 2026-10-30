import { describe, expect, it, vi } from 'vitest';
import { stripTerminalCatalogAlternative } from './fast-catalog-alternative';
import { interpretFastCatalogIntent } from './fast-catalog-intent';
import { buildFastCatalogReply } from './fast-catalog-reply';

const categories = [
  { id: 'phones', name: 'Smartphones', slug: 'smartphones' },
  { id: 'accessories', name: 'Accessories', slug: 'accessories' },
];

describe('customer product replacement follow-ups', () => {
  it('strips a terminal marker without stripping a following product', () => {
    expect(stripTerminalCatalogAlternative('Samsung instead, please?')).toBe(
      'Samsung'
    );
    expect(stripTerminalCatalogAlternative('Samsung instead, iPhone')).toBe(
      'Samsung instead, iPhone'
    );
  });

  it('handles a maximum-length nonmatching alternative marker input', () => {
    const text = `A${'.'.repeat(9_990)}?X`;
    expect(stripTerminalCatalogAlternative(text)).toBe(text);
  }, 10_000);
  it('asks for a complete search instead of combining conflicting brands', async () => {
    const load = vi.fn(async () => []);
    const reply = await buildFastCatalogReply(
      ['Show me iPhones under 500k', 'Samsung instead'],
      categories,
      load,
      'NGN'
    );
    expect(reply?.events).toEqual([]);
    expect(reply?.text).toMatch(/new search.*product.*budget/i);
    expect(reply?.text).not.toMatch(/another page/i);
    expect(load).not.toHaveBeenCalled();
  });

  it('keeps the clarification until the new product and budget are explicit', () => {
    expect(
      interpretFastCatalogIntent(
        ['Show me iPhones under 500k', 'Samsung instead', 'Under 300k'],
        categories,
        'NGN'
      )
    ).toMatchObject({ kind: 'clarify', reason: 'more-needs-search' });
    expect(
      interpretFastCatalogIntent(
        [
          'Show me iPhones under 500k',
          'Samsung instead',
          'Samsung phones under 300k',
        ],
        categories,
        'NGN'
      )
    ).toMatchObject({ kind: 'search', query: 'Samsung', maxPrice: 300_000 });
  });

  it.each([
    'Samsung phones instead',
    'Samsung Galaxy S24 instead',
    'What about Samsung?',
    'How about Samsung?',
    'Switch to Samsung',
    'Samsung instead under 300k',
  ])('does not discard or combine the earlier search for %s', (replacement) => {
    expect(
      interpretFastCatalogIntent(
        ['Show me iPhones under 500k', replacement],
        categories,
        'NGN'
      )
    ).toMatchObject({ kind: 'clarify', reason: 'more-needs-search' });
  });

  it('retains a pending replacement across an acknowledgement', () => {
    expect(
      interpretFastCatalogIntent(
        ['Show me iPhones under 500k', 'Samsung instead', 'OK', 'Samsung'],
        categories,
        'NGN'
      )
    ).toMatchObject({ kind: 'clarify', reason: 'more-needs-search' });
    expect(
      interpretFastCatalogIntent(
        ['Show me iPhones under 500k', 'Samsung instead', 'OK'],
        categories,
        'NGN'
      )
    ).toBeNull();
  });

  it.each([
    'I would prefer Samsung',
    'I want a Samsung',
    'Samsung for my brother',
  ])('retains a pending replacement across an incomplete product preference: %s', (fragment) => {
    expect(
      interpretFastCatalogIntent(
        [
          'Show me iPhones under 500k',
          'Samsung instead',
          fragment,
          'Samsung phones',
        ],
        categories,
        'NGN'
      )
    ).toMatchObject({ kind: 'clarify', reason: 'more-needs-search' });
  });

  it('does not carry a pending replacement across unrelated or order topics', () => {
    for (const boundary of ['Tell me a joke', 'Track my order']) {
      expect(
        interpretFastCatalogIntent(
          ['Show me iPhones under 500k', 'Samsung instead', boundary],
          categories,
          'NGN'
        )
      ).toBeNull();
    }
  });

  it('accepts a self-contained replacement with its own budget', () => {
    expect(
      interpretFastCatalogIntent(
        ['Show me iPhones under 500k', 'Samsung phones under 300k instead'],
        categories,
        'NGN'
      )
    ).toMatchObject({ kind: 'search', query: 'Samsung', maxPrice: 300_000 });
  });

  it.each([
    'What about the price of Samsung instead?',
    'What about the price of Samsung phones?',
  ])('does not mistake a product switch for a budget-only question: %s', (text) => {
    expect(
      interpretFastCatalogIntent(
        ['Show me iPhones under 500k', text],
        categories,
        'NGN'
      )
    ).toMatchObject({ kind: 'clarify', reason: 'more-needs-search' });
  });

  it('retains the product for a budget-only correction worded as an alternative', () => {
    expect(
      interpretFastCatalogIntent(
        ['Show me iPhones under 500k', 'What about under 300k instead?'],
        categories,
        'NGN'
      )
    ).toMatchObject({ kind: 'search', query: 'iPhone', maxPrice: 300_000 });
  });

  it.each([
    'What about the price?',
    'How about the price?',
    'What about the cost?',
  ])('keeps a price-only question attached to the prior product: %s', (question) => {
    expect(
      interpretFastCatalogIntent(
        ['Show me iPhones under 500k', question],
        categories,
        'NGN'
      )
    ).toMatchObject({ kind: 'search', query: 'iPhone', maxPrice: 500_000 });
  });

  it('does not accept a replacement with a trailing conflicting product', () => {
    for (const text of [
      'Samsung phones under 300k instead iPhone',
      'Samsung phones under 300k instead, iPhone',
      'Samsung phones under 300k instead: iPhone',
    ])
      expect(
        interpretFastCatalogIntent(
          ['Show me iPhones under 500k', text],
          categories,
          'NGN'
        )
      ).toMatchObject({ kind: 'clarify', reason: 'more-needs-search' });
  });

  it('keeps terminal alternative wording from contaminating later refinements', () => {
    expect(
      interpretFastCatalogIntent(
        [
          'Show me iPhones under 500k',
          'What about under 300k instead',
          'Under 250k',
        ],
        categories,
        'NGN'
      )
    ).toMatchObject({ kind: 'search', query: 'iPhone', maxPrice: 250_000 });
    expect(
      interpretFastCatalogIntent(
        [
          'Show me iPhones under 500k',
          'Samsung phones under 300k instead',
          'For gaming',
        ],
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

  it('accepts polite terminal alternative wording without inventing an operand', () => {
    expect(
      interpretFastCatalogIntent(
        ['Show me iPhones under 500k', 'What about under 300k instead please'],
        categories,
        'NGN'
      )
    ).toMatchObject({ kind: 'search', query: 'iPhone', maxPrice: 300_000 });
    expect(
      interpretFastCatalogIntent(
        [
          'Show me iPhones under 500k',
          'Samsung phones under 300k instead, please',
        ],
        categories,
        'NGN'
      )
    ).toMatchObject({ kind: 'search', query: 'Samsung', maxPrice: 300_000 });
  });

  it('handles a maximum-length punctuation-heavy nonmatching fragment', () => {
    expect(
      interpretFastCatalogIntent(
        [
          'Show me iPhones under 500k',
          'Samsung instead',
          `A${'.'.repeat(9_990)}?X`,
        ],
        categories,
        'NGN'
      )
    ).toMatchObject({ kind: 'clarify', reason: 'more-needs-search' });
  }, 10_000);
});
