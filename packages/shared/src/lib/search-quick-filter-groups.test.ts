import { expect, it } from 'vitest';
import { getSearchQuickFilterGroups } from './search-quick-filter-groups';
import { getSearchRefinementChips } from './search-refinement-chips';

it('adds only query-backed quick groups and keeps an active processor removable', () => {
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
