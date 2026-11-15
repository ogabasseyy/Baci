import { imeiVerifyButtonLabel } from './imei-verify-button-label';
import type { ImeiWalletCopy } from './imei-wallet-copy';

const walletCopy: ImeiWalletCopy = {
  balanceLabel: () => '',
  badgePrefix: null,
  loading: 'Loading',
  loadingButton: 'Checking wallet…',
  shortfallHint: () => '',
  topUpButton: 'Add funds',
  unavailable: 'Unavailable',
  unavailableButton: 'Wallet unavailable',
};
const base = {
  hasTier: true,
  isWalletLoading: false,
  isWalletError: false,
  needsTopUp: false,
  paysFromPiggyvest: false,
  walletCopy,
  tier: { price: 1500, name: 'Full Report' },
};

// With paying from PiggyVest switched off nothing says "Pay ... for": the
// footer keeps its store credit words.
describe('imeiVerifyButtonLabel', () => {
  it('asks for a check first', () => {
    expect(imeiVerifyButtonLabel({ ...base, hasTier: false })).toBe(
      'Choose a check'
    );
  });

  it('follows the wallet state before the price', () => {
    expect(imeiVerifyButtonLabel({ ...base, isWalletLoading: true })).toBe(
      'Checking wallet…'
    );
    expect(imeiVerifyButtonLabel({ ...base, isWalletError: true })).toBe(
      'Wallet unavailable'
    );
    expect(imeiVerifyButtonLabel({ ...base, needsTopUp: true })).toBe(
      'Add funds'
    );
  });

  it('names the check when the savings wallet pays, else shows the price', () => {
    expect(imeiVerifyButtonLabel({ ...base, paysFromPiggyvest: true })).toBe(
      'Pay ₦1,500 for Full Report'
    );
    expect(imeiVerifyButtonLabel(base)).toBe('Verify Now - ₦1,500');
  });

  it('never offers a savings wallet payment while it is switched off', () => {
    for (const needsTopUp of [false, true]) {
      expect(
        imeiVerifyButtonLabel({ ...base, needsTopUp, paysFromPiggyvest: false })
      ).not.toMatch(/^Pay /);
    }
  });
});
