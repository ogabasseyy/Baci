import { describe, expect, it } from 'vitest';
import { piggyvestCustomerLookupSchema } from './piggyvest-customer-lookup';

const listing = (edges: unknown[], hasNextPage = false) => ({
  paginatedPayload: { edges, pageInfo: { hasNextPage, endCursor: null } },
});

describe('piggyvestCustomerLookupSchema', () => {
  it('reads the customer id and echoed identifier from the proven list shape', () => {
    expect(
      piggyvestCustomerLookupSchema.parse(
        listing([
          { id: 'customer-1', third_party_identifier: 'baci:i:c', email: 'x' },
        ])
      ).paginatedPayload.edges
    ).toEqual([{ id: 'customer-1', third_party_identifier: 'baci:i:c' }]);
  });

  it.each([
    ['a missing page marker', { paginatedPayload: { edges: [] } }],
    ['a bare array', [{ id: 'customer-1' }]],
    ['a customer without an id', listing([{ third_party_identifier: 'x' }])],
    [
      'an unbounded page',
      listing(Array.from({ length: 21 }, (_unused, n) => ({ id: `c${n}` }))),
    ],
  ])('refuses %s', (_label, value) => {
    expect(piggyvestCustomerLookupSchema.safeParse(value).success).toBe(false);
  });
});
