import { useState } from 'react';
import type { PaymentMethodType } from './PaymentMethodSelector';

/**
 * Remembers which bank transfer the customer chose: "Bank transfer to
 * wallet" or the ordinary one-time transfer, as offered when they picked
 * it (Codex). A verdict that resolves later can then never turn their
 * one-time transfer into a wallet-funded one at Place Order.
 */
export function useTransferModeAtSelection() {
  const [walletFundedAtSelection, setWalletFundedAtSelection] = useState<
    boolean | null
  >(null);
  return {
    capture(method: PaymentMethodType | null, walletFundedOffered: boolean) {
      setWalletFundedAtSelection(
        method === 'bank_transfer' ? walletFundedOffered : null
      );
    },
    // The customer's choice stands once made (Codex): if wallet transfer
    // stops being eligible later, the Place Order hold falls back to a
    // one-time transfer and the bank-transfer page says so.
    effective(walletFundedOffered: boolean): boolean {
      return walletFundedAtSelection ?? walletFundedOffered;
    },
  };
}
