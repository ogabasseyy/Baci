import type { UseCheckoutSubmitParams } from './use-checkout-submit.types';

type WalletFundedTransferSubmitParams = Pick<
  UseCheckoutSubmitParams,
  | 'isWalletFundedBankTransferHeld'
  | 'walletFundedBankTransferOptionEnabled'
  | 'walletTransferFallbackReason'
>;

/**
 * The checkout submit's wallet-funded bank transfer inputs: the render-time
 * option plus the live re-check read at finalization.
 */
export function walletFundedTransferSubmitParams(
  controller: WalletFundedTransferSubmitParams
): WalletFundedTransferSubmitParams {
  return {
    isWalletFundedBankTransferHeld: controller.isWalletFundedBankTransferHeld,
    walletFundedBankTransferOptionEnabled:
      controller.walletFundedBankTransferOptionEnabled,
    walletTransferFallbackReason: controller.walletTransferFallbackReason,
  };
}
