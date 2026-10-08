import { describe, expect, it } from 'vitest';
import { piggyvestAccruedInterestSchemas } from './piggyvest-accrued-interest';

const query = { start_date: '2026-09-01', end_date: '2026-09-12' };

describe('piggyvestAccruedInterestSchemas', () => {
  it('defaults to a bounded original-interest page', () => {
    expect(piggyvestAccruedInterestSchemas.query.parse(query)).toEqual({
      ...query,
      limit: 31,
      interest_type: 'original',
    });
  });

  it.each([
    { start_date: '2026-02-30' },
    { end_date: '2026-08-31' },
    { start_date: '2026-9-01' },
    { start_date: '2026-09-01T00:00:00Z' },
    { limit: 0 },
    { limit: 101 },
    { limit: 1.5 },
    { limit: '31' },
    { cursor: 'x'.repeat(513) },
    { cursor: '\ud800' },
    { interest_type: 'paid' },
    { wallet_id: 'untrusted' },
  ])('rejects invalid query %j', (override) => {
    expect(
      piggyvestAccruedInterestSchemas.query.safeParse({ ...query, ...override })
        .success
    ).toBe(false);
  });

  it('accepts leap dates and a bounded opaque cursor', () => {
    expect(
      piggyvestAccruedInterestSchemas.query.safeParse({
        start_date: '2024-02-29',
        end_date: '2024-02-29',
        limit: 100,
        cursor: 'opaque +/&=?',
        interest_type: 'differential',
      }).success
    ).toBe(true);
  });

  it('requires explicit dates', () => {
    expect(piggyvestAccruedInterestSchemas.query.safeParse({}).success).toBe(
      false
    );
  });

  it.each([
    { hasNextPage: true, endCursor: null, previousCursor: null },
    { hasNextPage: true, endCursor: 'duplicate', previousCursor: 'duplicate' },
    { hasNextPage: false, endCursor: 'duplicate', previousCursor: 'duplicate' },
    { hasNextPage: 'true', endCursor: null, previousCursor: null },
    { hasNextPage: false, endCursor: 'x'.repeat(513), previousCursor: null },
    { hasNextPage: false, endCursor: null },
  ])('rejects malformed pagination %j', (pageInfo) => {
    expect(
      piggyvestAccruedInterestSchemas.response.safeParse({
        status: true,
        data: { paginatedPayload: { edges: [], pageInfo } },
      }).success
    ).toBe(false);
  });

  it('accepts a terminal empty page and strips extra response fields', () => {
    const page = {
      edges: [],
      pageInfo: { hasNextPage: false, endCursor: null, previousCursor: null },
    };
    expect(
      piggyvestAccruedInterestSchemas.response.parse({
        status: true,
        private_field: 'discard',
        data: { paginatedPayload: page },
      })
    ).toEqual({ status: true, data: { paginatedPayload: page } });
  });
});
