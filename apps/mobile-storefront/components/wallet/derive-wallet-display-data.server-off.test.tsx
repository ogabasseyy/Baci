import { describe, expect, it } from '@jest/globals';
import { deriveWalletDisplayData } from './derive-wallet-display-data';

// With the server keeping PiggyVest off the wallet carries no
// primary_balance_kobo: the display data is the legacy computation.
describe('wallet display data with the server off', () => {
  const legacyWallet = {
    balance: 5000,
    savings_balance: 2000,
    total_balance: 7000,
  };

  it('spends the legacy balance and flags no primary wallet', () => {
    const data = deriveWalletDisplayData(legacyWallet);
    expect(data.walletBalance).toBe(5000);
    expect(data.totalBalance).toBe(7000);
    expect('primaryReady' in data).toBe(false);
  });

  it('ignores a null primary balance left by a not-ready answer', () => {
    const data = deriveWalletDisplayData({
      ...legacyWallet,
      primary_balance_kobo: null,
    });
    expect(data.walletBalance).toBe(5000);
    expect('primaryReady' in data).toBe(false);
  });

  it('falls back to wallet plus savings when no total is reported', () => {
    const data = deriveWalletDisplayData({ balance: 300, savings_balance: 50 });
    expect(data.totalBalance).toBe(350);
  });

  it('shows no earnings or funding account for an empty wallet', () => {
    const data = deriveWalletDisplayData({});
    expect(data.walletBalance).toBe(0);
    expect(data.earningsAvailable).toBe(false);
    expect(data.earningsBalance).toBeNull();
    expect(data.fundingAccount).toBeNull();
    expect(data.activeSavingsGoal).toBeNull();
  });
});
