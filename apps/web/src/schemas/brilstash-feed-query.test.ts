import { expect, it } from 'vitest';
import { parseBrilStashFeedQuery } from './brilstash-feed-query';

it('uses a full first page by default and preserves valid sandbox filters', () => {
  expect(parseBrilStashFeedQuery(new URLSearchParams())).toEqual({
    page: 1,
    limit: 100,
    min_price: 0,
  });
  expect(
    parseBrilStashFeedQuery(
      new URLSearchParams('limit=7&page=2&min_price=100.50')
    )
  ).toEqual({
    page: 2,
    limit: 7,
    min_price: 100.5,
  });
});

it.each([
  'page=0',
  'limit=0',
  'limit=101',
  'min_price=-1',
  'min_price=1e3',
  'page=1&page=2',
  'unknown=x',
  'page=9007199254740991',
])('rejects invalid feed query %s', (query) =>
  expect(parseBrilStashFeedQuery(new URLSearchParams(query))).toBeNull());
