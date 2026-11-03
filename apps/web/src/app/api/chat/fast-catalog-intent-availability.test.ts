import { describe, expect, it } from 'vitest';
import { interpretFastCatalogIntent } from './fast-catalog-intent';

const categories = [
  { id: 'phones', name: 'Smartphones', slug: 'smartphones' },
  { id: 'accessories', name: 'Accessories', slug: 'accessories' },
];

describe('catalog availability requests', () => {
  it.each([
    ['What phones do you have in stock?', ''],
    ['Do you have any Samsung phones in stock?', 'Samsung'],
    ['Do you stock Samsung phones?', 'Samsung'],
    ['Do you currently stock Samsung phones?', 'Samsung'],
    ['Do you still stock Samsung phones?', 'Samsung'],
    ['Do you stock Stock S1 phones?', 'Stock S1'],
    ['Do you have Samsung Galaxy S24 in-stock?', 'Samsung Galaxy S24'],
    ['Which Samsung phones are currently in stock right now?', 'Samsung'],
    ['Samsung phones still in stock?', 'Samsung'],
    ['Samsung phones in stock currently?', 'Samsung'],
    ['Which Samsung phone models are in stock?', 'Samsung'],
    ['Show me StockX phones in stock', 'StockX'],
  ])('retains product terms but not availability wording: %s', (message, query) => {
    expect(interpretFastCatalogIntent([message], categories)).toMatchObject({
      kind: 'search',
      categoryId: 'phones',
      query,
    });
  });

  it('recognizes the stock verb when the product is not a phone', () => {
    expect(
      interpretFastCatalogIntent(
        ['Do you currently stock Nintendo Switch?'],
        categories
      )
    ).toMatchObject({ kind: 'search', query: 'Nintendo Switch' });
  });

  it('asks for a product type when a Pro Plus model has no resolved category', () => {
    expect(
      interpretFastCatalogIntent(
        ['Do you have Tecno Spark 40 Pro+?'],
        categories
      )
    ).toMatchObject({ kind: 'clarify', reason: 'product-type' });
    expect(
      interpretFastCatalogIntent(
        ['Tecno Spark 40 Pro+ phone in stock'],
        categories
      )
    ).toMatchObject({
      kind: 'search',
      categoryId: 'phones',
      query: 'Tecno Spark 40 Pro+',
    });
  });

  it.each([
    'A phone',
    'An accessory',
    'A phone please',
    'A phone, please.',
    'Yes, it is a phone, thanks',
    'Please, an accessory',
    'A phone pls',
    "Yes please, it's a phone",
  ])('does not discard the named model or budget after a short product-type reply: %s', (reply) => {
    expect(
      interpretFastCatalogIntent(
        ['Do you have Tecno Spark 40 Pro+ under 300k?', reply],
        categories
      )
    ).toMatchObject({ kind: 'clarify', reason: 'product-type' });
  });

  it('keeps the model clarification pending through repeated type replies', () => {
    expect(
      interpretFastCatalogIntent(
        [
          'Do you have Tecno Spark 40 Pro+ under 300k?',
          'A phone',
          'Phone please',
        ],
        categories
      )
    ).toMatchObject({ kind: 'clarify', reason: 'product-type' });
  });

  it.each([
    { messages: ['Do you have Tecno Spark 40 Pro+?', 'Under 300k', 'A phone'] },
    {
      messages: [
        'Do you have Tecno Spark 40 Pro+?',
        'How much is it?',
        'A phone',
      ],
    },
    { messages: ['Do you have Tecno Spark 40 Pro+?', 'A phone under 300k'] },
    {
      messages: [
        'Do you have Tecno Spark 40 Pro+?',
        'Is it in stock?',
        'A phone',
      ],
    },
    {
      messages: [
        'Do you have Tecno Spark 40 Pro+?',
        'Is it still available?',
        'A phone',
      ],
    },
  ])('keeps the model clarification pending through price refinements: $messages', ({
    messages,
  }) => {
    expect(interpretFastCatalogIntent(messages, categories)).toMatchObject({
      kind: 'clarify',
      reason: 'product-type',
    });
  });

  it('does not turn repeated type-only replies into a broad search after the context window', () => {
    expect(
      interpretFastCatalogIntent(
        [
          'Do you have Tecno Spark 40 Pro+ under 300k?',
          ...Array(7).fill('Phone'),
        ],
        categories
      )
    ).toMatchObject({ kind: 'clarify', reason: 'product-type' });
  });

  it.each([
    { messages: ['Under 300k', 'A phone'] },
    { messages: ['Phone', 'Phone'] },
    {
      messages: [
        'Do you have Tecno Spark 40 Pro+?',
        'I want to order under 300k',
        'Phone',
      ],
    },
    {
      messages: [
        'Do you have Tecno Spark 40 Pro+?',
        'Phones under 300k instead',
        'Phone',
      ],
    },
  ])('does not invent or revive a pending model across a boundary: $messages', ({
    messages,
  }) => {
    expect(interpretFastCatalogIntent(messages, categories)).not.toMatchObject({
      kind: 'clarify',
      reason: 'product-type',
    });
  });

  it('retains the accessory and budget in an availability request', () => {
    expect(
      interpretFastCatalogIntent(
        ['What chargers are in stock under 20k?'],
        categories
      )
    ).toMatchObject({
      kind: 'search',
      categoryId: 'accessories',
      query: 'charger',
      maxPrice: 20_000,
      exclusiveMaxPrice: true,
    });
  });

  it('preserves a Plus model in an in-stock accessory request', () => {
    expect(
      interpretFastCatalogIntent(
        ['Samsung Galaxy S21+ phone charger in stock'],
        categories
      )
    ).toMatchObject({
      kind: 'search',
      categoryId: 'accessories',
      query: 'Samsung Galaxy S21+ charger',
    });
  });

  it('clarifies an earbuds-and-case bundle while retaining a case-only search', () => {
    expect(
      interpretFastCatalogIntent(
        ['Samsung Galaxy Buds Plus with a case'],
        categories
      )
    ).toEqual({ kind: 'clarify', reason: 'options' });
    expect(
      interpretFastCatalogIntent(
        ['Samsung Galaxy Buds Plus in a case'],
        categories
      )
    ).toEqual({ kind: 'clarify', reason: 'options' });
    expect(
      interpretFastCatalogIntent(
        ['Samsung Galaxy Buds Plus in a charging case'],
        categories
      )
    ).toEqual({ kind: 'clarify', reason: 'options' });
    expect(
      interpretFastCatalogIntent(['Samsung Galaxy Buds Plus case'], categories)
    ).toMatchObject({
      kind: 'search',
      categoryId: 'accessories',
      query: 'Samsung Galaxy Buds Plus case',
    });
  });

  it('keeps an inclusive budget after the availability phrase', () => {
    expect(
      interpretFastCatalogIntent(
        ['Samsung phones in stock at most 500k'],
        categories
      )
    ).toMatchObject({
      kind: 'search',
      query: 'Samsung',
      maxPrice: 500_000,
      exclusiveMaxPrice: false,
    });
  });

  it('handles long whitespace inside an availability phrase', () => {
    const message = `Samsung phones in${' '.repeat(40_000)}stock`;
    expect(interpretFastCatalogIntent([message], categories)).toMatchObject({
      kind: 'search',
      query: 'Samsung',
    });
  });

  it('retains an availability search through a budget follow-up', () => {
    expect(
      interpretFastCatalogIntent(
        ['Show me Samsung phones in stock', 'Under 500k'],
        categories
      )
    ).toMatchObject({ kind: 'search', query: 'Samsung', maxPrice: 500_000 });
  });

  it('asks which product a price follow-up means after a broad stock search', () => {
    expect(
      interpretFastCatalogIntent(
        ['What phones do you have in stock?', 'What is the price?'],
        categories
      )
    ).toMatchObject({ kind: 'clarify', reason: 'product' });
  });

  it.each([
    'Show me phones out of stock',
    'Show me phones out-of-stock',
    'Show me phones not in stock',
    "Show me phones that aren't in stock",
    'Show me sold-out phones',
    'When will iPhone 16 be back in stock?',
    'How many Samsung phones do you have in stock?',
    'Which Samsung phones are in stock at the Lagos store?',
    'Samsung Galaxy S21 plus charger in stock',
    'Samsung Galaxy S21 Plus phone charger in stock',
    'Samsung Galaxy S21 + 5G in stock',
    'Samsung Galaxy S21 +5G in stock',
    'Samsung Galaxy S21+charger in stock',
    'Samsung Galaxy S21+screen protector in stock',
    'Samsung Galaxy S21+power bank in stock',
    'Samsung Galaxy S21+USB-C charger in stock',
    'Samsung Galaxy S21+wireless charger in stock',
    'Samsung Galaxy S21＋USB-C charger in stock',
    'iPhone 6s+USB-C charger in stock',
    'Tecno Spark 40 Pro+USB-C charger in stock',
    'Tecno Spark 40 Pro + charger in stock',
  ])('does not turn an unavailable or future-stock question into an available search: %s', (message) => {
    expect(interpretFastCatalogIntent([message], categories)).toMatchObject({
      kind: 'clarify',
      reason: 'options',
    });
  });
});
