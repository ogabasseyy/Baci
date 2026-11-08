import { expect, it } from 'vitest';
import { searchPageTotalPages } from './search-page-total-pages';

it('bounds pages and handles failed or empty results', () => {
  const result = {
    count: 45,
    totalCount: 45,
    products: [],
    productIds: [],
    query: 'phone',
  };
  expect(searchPageTotalPages(result, false)).toBe(3);
  expect(searchPageTotalPages(result, true)).toBe(0);
  expect(
    searchPageTotalPages({ ...result, count: 0, totalCount: 0 }, false)
  ).toBe(0);
  expect(
    searchPageTotalPages({ ...result, totalCount: 1000000000 }, false)
  ).toBeLessThan(1000000);
});
