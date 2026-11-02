import type { SearchSort } from '@baci/shared/lib';
import { describe, expect, it } from '@jest/globals';
import {
  getSandboxProcessorFamily,
  sortSandboxProducts,
} from './sandbox-product-refinements';

describe('getSandboxProcessorFamily', () => {
  it.each([
    ['Intel Core i7-1360P', 'Intel Core i7'],
    ['AMD Ryzen 7 7840U', 'AMD Ryzen 7'],
    ['Apple M3 Pro', 'Apple M3'],
    ['Intel Core Ultra 7 155H', 'Intel Core Ultra 7'],
    ['Snapdragon X Elite', 'Snapdragon X Elite'],
  ])('extracts the processor family from %s', (value, expected) => {
    expect(getSandboxProcessorFamily({ Processor: value })).toBe(expected);
  });

  it('reads processor values from specification sections', () => {
    expect(
      getSandboxProcessorFamily([
        { items: [{ label: 'CPU', value: 'Intel Core i5-1235U' }] },
      ])
    ).toBe('Intel Core i5');
  });

  it('returns null for no recognized family or ambiguous families', () => {
    expect(
      getSandboxProcessorFamily({ Processor: 'Apple A17 Pro' })
    ).toBeNull();
    expect(
      getSandboxProcessorFamily({
        Processor: 'Intel Core i7 and AMD Ryzen 7',
      })
    ).toBeNull();
  });
});

describe('sortSandboxProducts', () => {
  const products = [
    { id: 'b', price: 20, created_at: '2024-02-01', view_count: 5 },
    { id: 'c', price: null, created_at: null, view_count: null },
    { id: 'a', price: 10, created_at: '2024-01-01', view_count: 10 },
  ];

  const sortCases: [SearchSort, string[]][] = [
    ['price_asc', ['a', 'b', 'c']],
    ['price_desc', ['b', 'a', 'c']],
    ['newest', ['b', 'a', 'c']],
    ['popular', ['a', 'b', 'c']],
    ['relevance', ['b', 'a', 'c']],
  ];

  it.each(
    sortCases
  )('sorts %s values and keeps nulls last', (sort, expectedIds) => {
    expect(sortSandboxProducts(products, sort).map(({ id }) => id)).toEqual(
      expectedIds
    );
  });

  it('uses id as a stable deterministic tie breaker and does not mutate input', () => {
    const tied = [
      { id: 'z', price: 10 },
      { id: 'a', price: 10 },
    ];

    expect(sortSandboxProducts(tied, 'price_asc').map(({ id }) => id)).toEqual([
      'a',
      'z',
    ]);
    expect(tied.map(({ id }) => id)).toEqual(['z', 'a']);
  });
});
