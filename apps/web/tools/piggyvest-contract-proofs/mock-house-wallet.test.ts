import { describe, expect, it } from 'vitest';
import { createHouseWallet } from './mock-house-wallet';

describe('createHouseWallet', () => {
  it('starts empty, unrestricted and bound to no API customer', () => {
    expect(createHouseWallet('house-1', '2026-10-30T10:00:00.000Z')).toEqual({
      id: 'house-1',
      customerId: '',
      name: 'Ogabassey Collection',
      createdAt: '2026-10-30T10:00:00.000Z',
      balance: 0,
      withdrawalCount: 0,
      lagged: null,
      staleBalance: null,
      settingsHiddenReads: 0,
      payoutHiddenReads: 0,
      payoutWalletId: null,
      interestEnabled: false,
      account: '9100000001',
    });
  });

  it('returns a fresh object each call, so sandboxes never share a balance', () => {
    const a = createHouseWallet('house-1', '2026-10-30T10:00:00.000Z');
    a.balance = 500;
    expect(
      createHouseWallet('house-1', '2026-10-30T10:00:00.000Z').balance
    ).toBe(0);
  });
});
