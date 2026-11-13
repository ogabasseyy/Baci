import { describe, expect, it } from '@jest/globals';
import { walletPurchaseProps } from './wallet-purchase-props';

describe('walletPurchaseProps', () => {
  it('passes store credit and the unsettled flag through', () => {
    expect(
      walletPurchaseProps({ legacyBalance: 1200, walletPrimaryUnsettled: true })
    ).toEqual({ storeCreditBalance: 1200, walletPrimaryUnsettled: true });
  });

  it('keeps a legacy wallet unflagged with no store credit line', () => {
    expect(walletPurchaseProps({})).toEqual({
      storeCreditBalance: undefined,
      walletPrimaryUnsettled: false,
    });
    expect(walletPurchaseProps(undefined).walletPrimaryUnsettled).toBe(false);
  });
});
