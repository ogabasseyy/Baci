import { afterEach, describe, expect, it } from '@jest/globals';
import {
  clearObservedPiggyvestPrimaryCapability,
  observePiggyvestPrimaryCapability,
} from '@/lib/piggyvest-primary-capability-cache';
import {
  isSubmitWalletTransferHeld,
  submitWalletTransferChecks,
} from './is-submit-wallet-transfer-held';

const MERCHANT = '0f6c1a2e-3b4d-4e5f-8a9b-1c2d3e4f5a6b';

describe('isSubmitWalletTransferHeld', () => {
  afterEach(() => clearObservedPiggyvestPrimaryCapability());

  it('keeps the transfer with the server keeping PiggyVest off', () => {
    observePiggyvestPrimaryCapability(MERCHANT, false);
    expect(
      isSubmitWalletTransferHeld({
        merchantId: MERCHANT,
        optionEnabled: true,
        walletVerdict: {
          walletIsStoreCredit: false,
          walletPrimaryUnknown: false,
        },
      })
    ).toBe(false);
  });

  it('holds when the option is no longer eligible', () => {
    observePiggyvestPrimaryCapability(MERCHANT, false);
    expect(
      isSubmitWalletTransferHeld({
        merchantId: MERCHANT,
        optionEnabled: false,
        walletVerdict: {},
      })
    ).toBe(true);
  });

  it('holds when the live verdict is PiggyVest', () => {
    observePiggyvestPrimaryCapability(MERCHANT, true);
    expect(
      isSubmitWalletTransferHeld({
        merchantId: MERCHANT,
        optionEnabled: true,
        walletVerdict: {},
      })
    ).toBe(true);
  });

  it('bugfix: holds when the wallet turned PiggyVest under a cached ruling-out', () => {
    observePiggyvestPrimaryCapability(MERCHANT, false);
    expect(
      isSubmitWalletTransferHeld({
        merchantId: MERCHANT,
        optionEnabled: true,
        walletVerdict: { walletIsStoreCredit: true },
      })
    ).toBe(true);
  });
});

describe('bugfix: fallback notice blamed a slow check for a PiggyVest wallet', () => {
  afterEach(() => clearObservedPiggyvestPrimaryCapability());

  it('names PiggyVest when the wallet turned PiggyVest under a cached ruling-out', () => {
    // Arrange: the hold fires on the wallet shape, not the verdict.
    observePiggyvestPrimaryCapability(MERCHANT, false);
    const checks = submitWalletTransferChecks({
      getWalletVerdict: () => ({ walletIsStoreCredit: true }),
      merchantId: MERCHANT,
      optionEnabled: true,
    });

    // Act + Assert
    expect(checks.isWalletFundedBankTransferHeld()).toBe(true);
    expect(checks.walletTransferFallbackReason()).toBe('piggyvest');
  });

  it('stays "unconfirmed" while the wallet is only pending', () => {
    observePiggyvestPrimaryCapability(MERCHANT, false);
    const checks = submitWalletTransferChecks({
      getWalletVerdict: () => ({ walletPrimaryUnknown: true }),
      merchantId: MERCHANT,
      optionEnabled: true,
    });
    expect(checks.walletTransferFallbackReason()).toBe('unconfirmed');
  });
});
