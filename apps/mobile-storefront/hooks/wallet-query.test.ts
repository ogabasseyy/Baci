import { describe, expect, it } from '@jest/globals';
import { QueryClient } from '@tanstack/react-query';
import { walletKeys } from './wallet-query';

describe('walletKeys', () => {
  it('builds merchant-scoped wallet data query keys', () => {
    expect(
      walletKeys.data({ merchantId: 'merchant-1', ownerId: 'customer-1' })
    ).toEqual(['wallet', 'data', 'v4', 'customer-1', 'merchant-1']);
  });

  it('pins the key to the auth user when one is known', () => {
    expect(
      walletKeys.data({
        merchantId: 'merchant-1',
        ownerId: 'customer-1',
        userId: 'user-1',
      })
    ).toEqual(['wallet', 'data', 'v4', 'customer-1', 'merchant-1', 'user-1']);
  });

  it('keeps the key short for prefix invalidators without a user', () => {
    expect(
      walletKeys.data({
        merchantId: 'merchant-1',
        ownerId: 'customer-1',
        userId: undefined,
      })
    ).toEqual(['wallet', 'data', 'v4', 'customer-1', 'merchant-1']);
  });

  it('rejects missing merchant ids', () => {
    expect(() =>
      walletKeys.data({ merchantId: '', ownerId: 'customer-1' })
    ).toThrow('wallet data query keys require a merchantId');
  });

  it('rejects missing owner ids', () => {
    expect(() =>
      walletKeys.data({ merchantId: 'merchant-1', ownerId: '' })
    ).toThrow('wallet data query keys require an ownerId');
  });

  it('builds customer-scoped transaction keys', () => {
    expect(walletKeys.transactions('customer-1')).toEqual([
      'wallet',
      'transactions',
      'customer-1',
    ]);
    expect(walletKeys.transactions('customer-2')).toEqual([
      'wallet',
      'transactions',
      'customer-2',
    ]);
  });

  it('rejects missing transaction customer ids', () => {
    expect(() => walletKeys.transactions('')).toThrow(
      'wallet transaction query keys require a customerId'
    );
  });

  it('freezes generated query key tuples', () => {
    expect(
      Object.isFrozen(
        walletKeys.data({ merchantId: 'merchant-1', ownerId: 'customer-1' })
      )
    ).toBe(true);
    expect(Object.isFrozen(walletKeys.transactions('customer-1'))).toBe(true);
  });

  it('short-key invalidate with exact:false clears the user-pinned long key', async () => {
    // Post-purchase invalidation deliberately omits userId so one
    // prefix clears both key shapes. This pins the TanStack prefix
    // semantics that correctness depends on: if a future major flips
    // the default, this fails loudly instead of silently returning
    // stale pre-debit balances.
    const queryClient = new QueryClient();
    try {
      const longKey = walletKeys.data({
        merchantId: 'merchant-1',
        ownerId: 'customer-1',
        userId: 'user-1',
      });
      queryClient.setQueryData(longKey, { balance: 1 });

      await queryClient.invalidateQueries({
        queryKey: walletKeys.data({
          merchantId: 'merchant-1',
          ownerId: 'customer-1',
        }),
        exact: false,
      });

      expect(queryClient.getQueryState(longKey)?.isInvalidated).toBe(true);
    } finally {
      queryClient.clear();
    }
  });
});
