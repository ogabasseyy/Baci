import { describe, expect, it, vi } from 'vitest';
import { lookupPrimaryWalletCustomer } from './primary-wallet-customer-lookup';
import {
  customerListing,
  THIRD_PARTY_IDENTIFIER,
} from './primary-wallet-onboarding.test-fixture';

vi.mock('server-only', () => ({}));

const lookup = (answer: () => Promise<unknown>) =>
  lookupPrimaryWalletCustomer({
    thirdPartyIdentifier: THIRD_PARTY_IDENTIFIER,
    findCustomers: answer,
  });

describe('primary wallet customer lookup', () => {
  it('asks PiggyVest by our identifier', async () => {
    const findCustomers = vi.fn().mockResolvedValue(customerListing([]));
    await lookupPrimaryWalletCustomer({
      thirdPartyIdentifier: THIRD_PARTY_IDENTIFIER,
      findCustomers,
    });
    expect(findCustomers).toHaveBeenCalledExactlyOnceWith(
      THIRD_PARTY_IDENTIFIER
    );
  });

  it('proves no customer only from a complete, empty listing', async () => {
    expect(await lookup(async () => customerListing([]))).toEqual({
      kind: 'none',
    });
  });

  it.each([
    ['once', ['customer-1']],
    ['twice', ['customer-1', 'customer-1']],
  ])('finds exactly one customer carrying our identifier, listed %s', async (_label, ids) => {
    expect(await lookup(async () => customerListing(ids))).toEqual({
      kind: 'found',
      customerId: 'customer-1',
    });
  });

  it('reports several distinct customers carrying our identifier as ambiguous, never as one', async () => {
    expect(await lookup(async () => customerListing(['a', 'b']))).toEqual({
      kind: 'ambiguous',
    });
  });

  it.each([
    ['the request fails', () => Promise.reject(new Error('timeout'))],
    [
      'more pages follow',
      async () => customerListing([], { hasNextPage: true }),
    ],
    [
      'a listed customer does not echo our identifier',
      async () => customerListing(['a'], { identifier: 'baci:other:customer' }),
    ],
    ['the answer is malformed', async () => ({ customers: [] })],
  ])('reports unknown, never none, when %s', async (_label, answer) => {
    expect(await lookup(answer)).toEqual({ kind: 'unknown' });
  });
});
