import { describe, expect, it } from '@jest/globals';
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
});
