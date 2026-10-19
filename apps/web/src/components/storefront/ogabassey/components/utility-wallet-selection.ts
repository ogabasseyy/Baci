'use client';

import { captureClientEvent } from '@/lib/posthog/capture-client-event';
import { WALLET_FUNDING_TELEMETRY } from '@/lib/posthog/wallet-funding-events';

/**
 * Wallet-method selection handler for the utility modal. Extracted
 * from UtilityModal per the 300-line ceiling (Codex R137 P1):
 * emits the paymentMethodSelected telemetry event, then arms
 * wallet payment. Pure factory (no hooks) — the modal calls it
 * during render like the inline handler it replaces.
 */
export function createSelectWalletHandler({
  canUseWallet,
  customerId,
  merchantSlug,
  setPayWithWallet,
  walletBalance,
}: {
  canUseWallet: boolean;
  customerId: string | null | undefined;
  merchantSlug: string | null | undefined;
  setPayWithWallet: (value: boolean) => void;
  walletBalance: number;
}): () => void {
  return () => {
    captureClientEvent(
      WALLET_FUNDING_TELEMETRY.events.paymentMethodSelected,
      {
        method: 'wallet',
        wallet_balance: walletBalance,
        can_use_wallet: canUseWallet,
        merchant_slug: merchantSlug,
        customer_id: customerId,
      }
    );
    setPayWithWallet(true);
  };
}
