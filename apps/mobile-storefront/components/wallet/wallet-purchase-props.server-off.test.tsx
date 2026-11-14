import { describe, expect, it } from '@jest/globals';
import { walletPurchaseProps } from './wallet-purchase-props';

describe('walletPurchaseProps', () => {
  it('passes store credit and the unsettled flag through', () => {
    expect(
      walletPurchaseProps({ legacyBalance: 1200, walletPrimaryUnsettled: true })
    ).toEqual({
      primaryUnreadable: false,
      savingsPrimary: false,
      storeCreditBalance: 1200,
      walletPrimaryUnsettled: true,
    });
  });

  it('keeps a legacy wallet unflagged with no store credit line', () => {
    expect(walletPurchaseProps({})).toEqual({
      primaryUnreadable: false,
      savingsPrimary: false,
      storeCreditBalance: undefined,
      walletPrimaryUnsettled: false,
    });
    expect(walletPurchaseProps(undefined).walletPrimaryUnsettled).toBe(false);
  });
});

describe('bugfix: unreachable PiggyVest read showed the goals total as the balance', () => {
  it('passes the unreadable PiggyVest read through to the wallet card', () => {
    expect(
      walletPurchaseProps({ primaryUnreadable: true }).primaryUnreadable
    ).toBe(true);
  });
});
