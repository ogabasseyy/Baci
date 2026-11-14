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

  it('quotes the card minimum when the shortfall is below it', () => {
    expect(getImeiWalletCopy(true).shortfallHint(50)).toBe(
      'Add ₦100 store credit by card to run this check'
    );
    // Legacy wording is unchanged.
    expect(getImeiWalletCopy(false).shortfallHint(50)).toBe(
      'Balance low — top up ₦50 to run this check'
    );
  });
});

describe('bugfix: IMEI hint quoted ₦50 while the card-only sheet prefilled ₦100', () => {
  it('quotes the card minimum when the top-up is card-only under the wallet wording', () => {
    // Arrange: Ogabassey, verdict still unknown, legacy-shaped wallet.
    const copy = getImeiWalletCopy(false, true);

    // Act + Assert: the hint matches the sheet's prefill.
    expect(copy.shortfallHint(50)).toBe(
      'Balance low — top up ₦100 to run this check'
    );
    expect(copy.topUpButton).toBe('Top up to unlock');
  });

  it("keeps today's exact hint where PiggyVest is ruled out", () => {
    expect(getImeiWalletCopy(false, false).shortfallHint(50)).toBe(
      'Balance low — top up ₦50 to run this check'
    );
  });
});
