import type { PiggyvestShortfallVerdict } from '@/lib/prompt-piggyvest-utility-shortfall';
import { readPiggyvestCapabilityNow } from '@/lib/read-piggyvest-capability-now';
import type { WalletTransferFallback } from './wallet-transfer-fallback';

/**
 * Place Order re-check for a wallet-funded bank transfer. Holds (the order
 * falls back to a one-time transfer with a notice) when the option is no
 * longer eligible, when the live verdict is not a ruling-out, or when the
 * live wallet read (the query cache at call time, Codex) is
 * PiggyVest-shaped (Muse): a wallet that turned
 * PiggyVest after render must never fund the order, even while a stale
 * ruling-out is still cached. Fetching or error flags are not read, so a
 * refresh in flight never switches the rail.
 */
/**
 * Why a held transfer fell back, from the same reads as the hold (Muse): a
 * PiggyVest verdict or a PiggyVest-ready wallet is the PiggyVest case even
 * under a stale ruling-out; anything else couldn't be confirmed in time.
 */
export function submitWalletTransferFallbackReason({
  merchantId,
  walletVerdict,
}: {
  merchantId: string;
  walletVerdict: PiggyvestShortfallVerdict;
}): WalletTransferFallback {
  return readPiggyvestCapabilityNow(merchantId) === true ||
    walletVerdict.walletIsStoreCredit === true
    ? 'piggyvest'
    : 'unconfirmed';
}

/**
 * The Place Order callbacks: both read the query cache as it stands when
 * the order finalizes, not the render's snapshot (Codex).
 */
export function submitWalletTransferChecks({
  getWalletVerdict,
  merchantId,
  optionEnabled,
}: {
  getWalletVerdict: () => PiggyvestShortfallVerdict;
  merchantId: string;
  optionEnabled: boolean;
}) {
  return {
    isWalletFundedBankTransferHeld: () =>
      isSubmitWalletTransferHeld({
        merchantId,
        optionEnabled,
        walletVerdict: getWalletVerdict(),
      }),
    walletTransferFallbackReason: () =>
      submitWalletTransferFallbackReason({
        merchantId,
        walletVerdict: getWalletVerdict(),
      }),
  };
}

export function isSubmitWalletTransferHeld({
  merchantId,
  optionEnabled,
  walletVerdict,
}: {
  merchantId: string;
  optionEnabled: boolean;
  walletVerdict: PiggyvestShortfallVerdict;
}): boolean {
  if (!optionEnabled) return true;
  if (readPiggyvestCapabilityNow(merchantId) !== false) return true;
  return (
    walletVerdict.walletIsStoreCredit === true ||
    walletVerdict.walletPrimaryUnknown === true
  );
}
