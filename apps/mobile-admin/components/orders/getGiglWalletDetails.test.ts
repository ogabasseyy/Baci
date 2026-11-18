import { describe, expect, it } from 'vitest';
import { getGiglWalletDetails } from './getGiglWalletDetails';

describe('getGiglWalletDetails', () => {
  it('returns nothing when there is no wallet', () => {
    expect(getGiglWalletDetails(null)).toEqual([]);
  });

  it('says Paid by Baci for platform-funded shipping, even with no balance', () => {
    expect(
      getGiglWalletDetails({
        availableBalance: 0,
        canBook: true,
        paidByBaci: true,
        shortfall: 0,
      })
    ).toEqual([{ text: 'Paid by Baci' }]);
  });

  it('says From your wallet when the balance covers the delivery', () => {
    expect(
      getGiglWalletDetails({
        availableBalance: 5000,
        canBook: true,
        shortfall: 0,
      })
    ).toEqual([{ text: 'From your wallet' }]);
  });

  it('shows the balance and a top-up warning when the wallet falls short', () => {
    const details = getGiglWalletDetails({
      availableBalance: 1000,
      canBook: false,
      shortfall: 2500,
    });

    expect(details).toHaveLength(2);
    expect(details[0].text).toContain('Wallet balance:');
    expect(details[1]).toMatchObject({ tone: 'warning' });
    expect(details[1].text).toContain('to book');
  });
});
