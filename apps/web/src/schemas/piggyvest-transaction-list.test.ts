import { describe, expect, it } from 'vitest';
import { piggyvestTransactionListSchemas as schemas } from './piggyvest-transaction-list';

describe('transaction list schemas', () => {
  it('defaults to one bounded page', () => {
    expect(schemas.query.parse({})).toEqual({ limit: 20 });
  });
  it.each([
    { limit: 0 },
    { limit: 101 },
    { limit: 1.5 },
    { wallet_id: 'forged' },
    { collapse_batch: '1' },
    { cursor: 'x'.repeat(513) },
    { cursor: '\n' },
  ])('rejects unbounded or injected queries', (query) => {
    expect(schemas.query.safeParse(query).success).toBe(false);
  });
  it('accepts opaque cursors without decoding their contents', () => {
    expect(schemas.query.parse({ cursor: '%2F +/cursor' })).toEqual({
      limit: 20,
      cursor: '%2F +/cursor',
    });
  });
  it.each([
    { hasNextPage: true, endCursor: null, previousCursor: null },
    { hasNextPage: false, endCursor: 'same', previousCursor: 'same' },
  ])('rejects inconsistent pagination', (pageInfo) => {
    expect(
      schemas.response.safeParse({
        status: true,
        data: { edges: [], pageInfo },
      }).success
    ).toBe(false);
  });
});
