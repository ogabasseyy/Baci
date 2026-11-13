import { isWalletPrimaryUnknown } from '@/lib/is-wallet-primary-unknown';
import { readPiggyvestCapabilityNow } from '@/lib/read-piggyvest-capability-now';
import {
  isWalletStoreCredit,
  type WalletPrimaryLike,
} from '@/lib/wallet-store-credit';

/**
 * Place Order re-check for a wallet-funded bank transfer. Holds (the order
 * falls back to a one-time transfer with a notice) when the option is no
 * longer eligible, when the live verdict is not a ruling-out, or when the
 * latest wallet read is PiggyVest-shaped (Muse): a wallet that turned
 * PiggyVest after render must never fund the order, even while a stale
 * ruling-out is still cached. Fetching or error flags are not read, so a
 * refresh in flight never switches the rail.
 */
export function isSubmitWalletTransferHeld({
  merchantId,
  optionEnabled,
  wallet,
}: {
  merchantId: string;
  optionEnabled: boolean;
  wallet: WalletPrimaryLike | null | undefined;
}): boolean {
  if (!optionEnabled) return true;
  if (readPiggyvestCapabilityNow(merchantId) !== false) return true;
  return isWalletStoreCredit(wallet) || isWalletPrimaryUnknown(wallet);
}
