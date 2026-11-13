import { afterEach, describe, expect, it } from '@jest/globals';
import {
  clearObservedPiggyvestPrimaryCapability,
  observePiggyvestPrimaryCapability,
} from '@/lib/piggyvest-primary-capability-cache';
import { isSubmitWalletTransferHeld } from './is-submit-wallet-transfer-held';

const MERCHANT = '0f6c1a2e-3b4d-4e5f-8a9b-1c2d3e4f5a6b';

describe('isSubmitWalletTransferHeld', () => {
  afterEach(() => clearObservedPiggyvestPrimaryCapability());

  it('keeps the transfer with the server keeping PiggyVest off', () => {
    observePiggyvestPrimaryCapability(MERCHANT, false);
    expect(
      isSubmitWalletTransferHeld({
        merchantId: MERCHANT,
        optionEnabled: true,
        wallet: { primary_balance_kobo: null },
      })
    ).toBe(false);
  });

  it('holds when the option is no longer eligible', () => {
    observePiggyvestPrimaryCapability(MERCHANT, false);
    expect(
      isSubmitWalletTransferHeld({
        merchantId: MERCHANT,
        optionEnabled: false,
        wallet: {},
      })
    ).toBe(true);
  });

  it('holds when the live verdict is PiggyVest', () => {
    observePiggyvestPrimaryCapability(MERCHANT, true);
    expect(
      isSubmitWalletTransferHeld({
        merchantId: MERCHANT,
        optionEnabled: true,
        wallet: {},
      })
    ).toBe(true);
  });

  it('bugfix: holds when the wallet turned PiggyVest under a cached ruling-out', () => {
    observePiggyvestPrimaryCapability(MERCHANT, false);
    expect(
      isSubmitWalletTransferHeld({
        merchantId: MERCHANT,
        optionEnabled: true,
        wallet: { primary_balance_kobo: 10_000 },
      })
    ).toBe(true);
  });
});
