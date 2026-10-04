import { describe, expect, it } from 'vitest';
import { getSearchRefinementChips } from './search-refinement-chips';

describe('applied search filters', () => {
  it('removes one exact brand while retaining price and sort', () => {
    const chips = getSearchRefinementChips(
      { brands: [' Apple ', 'Apple'], maxPrice: 0, sort: 'newest' },
      []
    );
    expect(chips.map((chip) => chip.key)).toEqual([
      'brand: Apple ',
      'brand:Apple',
      'price',
    ]);
    expect(chips[0].next).toEqual({
      brands: ['Apple'],
      maxPrice: 0,
      sort: 'newest',
    });
    expect(chips[2].next.maxPrice).toBeUndefined();
  });
});

it('adds only query-backed quick groups and keeps an active processor removable', async () => {
  const { getSearchQuickFilterGroups } = await import(
    './search-refinement-chips'
  );
  const criteria = { brands: [], sort: 'relevance' as const };
  expect(getSearchQuickFilterGroups(criteria, []).map((g) => g.label)).toEqual([
    'Brand',
    'Price',
    'Condition',
  ]);
  expect(
    getSearchQuickFilterGroups(
      criteria,
      [
        { id: '1', name: 'Laptops' },
        { id: '2', name: 'Gaming Laptops' },
      ],
      ['Intel Core i7']
    ).map((g) => g.label)
  ).toEqual(['Brand', 'Price', 'Condition', 'Type', 'Processor']);
  const selected = { ...criteria, processor: 'Intel Core i7' };
  expect(
    getSearchQuickFilterGroups(selected, []).find((g) => g.key === 'processor')
      ?.active
  ).toBe(true);
  expect(
    getSearchRefinementChips(selected, []).find((c) => c.key === 'processor')
      ?.next.processor
  ).toBeUndefined();
});

it('formats price chips in merchant currency without changing numeric criteria', () => {
  const criteria = {
    brands: [],
    sort: 'relevance' as const,
    minPrice: 100,
    maxPrice: 200,
  };
  const chip = getSearchRefinementChips(
    criteria,
    [],
    (price) => `$${price}`
  )[0];
  expect(chip.label).toContain('$100');
  expect(chip.label).toContain('$200');
  expect(chip.next.minPrice).toBeUndefined();
  expect(chip.next.maxPrice).toBeUndefined();
  expect(criteria.minPrice).toBe(100);
});
