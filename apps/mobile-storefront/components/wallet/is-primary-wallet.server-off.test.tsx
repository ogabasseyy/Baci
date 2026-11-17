import { describe, expect, it } from '@jest/globals';
import { isPrimaryWallet } from './is-primary-wallet';

describe('isPrimaryWallet', () => {
  it('is true once the PiggyVest main wallet is ready', () => {
    expect(isPrimaryWallet({ primaryReady: true, fundingAccount: null })).toBe(
      true
    );
  });

  it('bugfix: is true for a PiggyVest account whose balance is pending', () => {
    expect(isPrimaryWallet({ fundingAccount: { provider: 'piggyvest' } })).toBe(
      true
    );
  });

  it('bugfix: is true for a pending PiggyVest wallet with no account yet', () => {
    expect(
      isPrimaryWallet({ fundingAccount: null, savingsPrimary: true })
    ).toBe(true);
  });

  it('stays false for a legacy wallet with a legacy account', () => {
    expect(
      isPrimaryWallet({
        fundingAccount: { provider: 'paystack' },
        primaryReady: false,
      })
    ).toBe(false);
    expect(isPrimaryWallet({})).toBe(false);
  });
});
