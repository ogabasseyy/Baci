import { describe, expect, it } from 'vitest';
import { calculateAdminWalletFunding } from './calculate-admin-wallet-funding';

describe('calculateAdminWalletFunding', () => {
  it('can book when the balance covers the price', () => {
    expect(calculateAdminWalletFunding(4500, 10000)).toEqual({
      availableBalance: 10000,
      shortfall: 0,
      canBook: true,
    });
  });

  it('reports the shortfall when the balance is too low', () => {
    expect(calculateAdminWalletFunding(4500, 1000)).toEqual({
      availableBalance: 1000,
      shortfall: 3500,
      canBook: false,
    });
  });

  it('treats negative and non-finite balances as zero', () => {
    expect(calculateAdminWalletFunding(4500, -50).availableBalance).toBe(0);
    expect(calculateAdminWalletFunding(4500, Number.NaN)).toEqual({
      availableBalance: 0,
      shortfall: 4500,
      canBook: false,
    });
  });
});
