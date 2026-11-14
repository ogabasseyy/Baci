import { describe, expect, it } from '@jest/globals';
import { walletFundedTransferSubmitParams } from './wallet-funded-transfer-submit-params';

describe('walletFundedTransferSubmitParams', () => {
  it('passes the render-time option and the live re-check through', () => {
    const isWalletFundedBankTransferHeld = () => true;

    const params = walletFundedTransferSubmitParams({
      isWalletFundedBankTransferHeld,
      walletFundedBankTransferOptionEnabled: true,
    });

    expect(params).toEqual({
      isWalletFundedBankTransferHeld,
      walletFundedBankTransferOptionEnabled: true,
      walletTransferFallbackReason: undefined,
    });
  });

  it('keeps the option off when the controller has it off', () => {
    expect(
      walletFundedTransferSubmitParams({
        walletFundedBankTransferOptionEnabled: false,
      }).walletFundedBankTransferOptionEnabled
    ).toBe(false);
  });
});
