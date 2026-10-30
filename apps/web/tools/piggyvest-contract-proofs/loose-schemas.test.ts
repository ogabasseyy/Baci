import { describe, expect, it } from 'vitest';
import {
  createDataSchema,
  extractEdges,
  isOwnedBy,
  pickString,
  walletDataSchema,
} from './loose-schemas';

describe('extractEdges', () => {
  const edges = [{ id: 'a' }, { id: 'b' }];
  const pageInfo = { hasNextPage: false };
  it.each([
    ['paginatedPayload.edges', { paginatedPayload: { edges, pageInfo } }],
    ['edges', { edges, pageInfo }],
    ['array', edges],
  ])('finds the list in the %s container', (container, data) => {
    expect(extractEdges(data)).toMatchObject({ container, edges });
  });

  it('reports an unknown container instead of guessing', () => {
    expect(extractEdges({ rows: edges })).toEqual({
      container: 'unknown',
      edges: [],
      pageInfo: null,
    });
    expect(extractEdges(undefined).container).toBe('unknown');
  });

  it('returns the page info when present', () => {
    expect(
      extractEdges({ paginatedPayload: { edges, pageInfo } }).pageInfo
    ).toEqual(pageInfo);
  });
});

describe('pickString', () => {
  it('returns the first non-empty string among candidate keys', () => {
    expect(
      pickString({ id: '', customer_id: 'c-1' }, ['id', 'customer_id'])
    ).toBe('c-1');
    expect(pickString({ id: 5 }, ['id'])).toBeNull();
    expect(pickString(null, ['id'])).toBeNull();
  });
});

describe('schemas and ownership', () => {
  it('accepts extra provider fields (loose) on create and wallet data', () => {
    expect(
      createDataSchema.parse({
        customer_id: 'c',
        wallet_id: 'w',
        new_customer: false,
        extra: 1,
      })
    ).toMatchObject({ extra: 1 });
    expect(
      walletDataSchema.safeParse({
        id: 'w',
        balance: 0,
        withdrawal_count: 0,
        anything: true,
      }).success
    ).toBe(true);
    expect(walletDataSchema.safeParse({ id: 'w', balance: 'x' }).success).toBe(
      false
    );
  });

  it('proves ownership only from an explicit matching api_customer_id', () => {
    expect(isOwnedBy({ api_customer_id: 'cust-1' }, 'cust-1')).toBe(true);
    expect(isOwnedBy({ api_customer_id: 'cust-2' }, 'cust-1')).toBe(false);
    expect(isOwnedBy({}, 'cust-1')).toBe(false);
    expect(isOwnedBy({ api_customer_id: null }, 'cust-1')).toBe(false);
    expect(isOwnedBy(null, 'cust-1')).toBe(false);
  });
});
