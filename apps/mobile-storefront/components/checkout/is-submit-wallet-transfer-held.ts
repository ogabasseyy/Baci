import type { PiggyvestShortfallVerdict } from '@/lib/prompt-piggyvest-utility-shortfall';
import { readPiggyvestCapabilityNow } from '@/lib/read-piggyvest-capability-now';

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
