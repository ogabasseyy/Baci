import { describe, expect, it } from '@jest/globals';
import { getImeiWalletCopy } from './imei-wallet-copy';

// With the server keeping PiggyVest off, the IMEI screen keeps its wallet
// wording exactly as before.
describe('IMEI wallet copy with the server off', () => {
  it('keeps the wallet wording when the wallet is not store credit', () => {
    const copy = getImeiWalletCopy(false);
    expect(copy.balanceLabel(0)).toBe('Wallet balance ₦0');
    expect(copy.badgePrefix).toBeNull();
    expect(copy.topUpButton).toBe('Top up to unlock');
    expect(copy.shortfallHint(1500)).toBe(
      'Balance low — top up ₦1,500 to run this check'
    );
  });

  it('labels the balance as store credit for PiggyVest customers', () => {
    const copy = getImeiWalletCopy(true);
    expect(copy.balanceLabel(0)).toBe('Store credit ₦0');
    expect(copy.badgePrefix).toBe('Store credit');
    expect(copy.topUpButton).toBe('Add store credit');
    expect(copy.shortfallHint(1500)).toBe(
      'Add ₦1,500 store credit by card to run this check'
    );
  });
});
