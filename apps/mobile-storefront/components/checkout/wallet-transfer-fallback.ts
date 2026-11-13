import { readPiggyvestCapabilityNow } from '@/lib/read-piggyvest-capability-now';
import { useAuthStore } from '@/stores/auth-store';

/**
 * Why Place Order switched "Bank transfer to wallet" to a one-time
 * transfer: PiggyVest is on for this merchant (by design), or the app
 * couldn't confirm the wallet in time (Muse: say so, don't call it
 * unavailable).
 */
export type WalletTransferFallback = 'piggyvest' | 'unconfirmed';

export function walletTransferFallbackReason(): WalletTransferFallback {
  return readPiggyvestCapabilityNow(useAuthStore.getState().merchantId) === true
    ? 'piggyvest'
    : 'unconfirmed';
}

/** Route param to reason; the original "1" meant the PiggyVest case. */
export function parseWalletTransferFallback(
  value: string | undefined
): WalletTransferFallback | undefined {
  if (value === 'unconfirmed') return 'unconfirmed';
  if (value === 'piggyvest' || value === '1') return 'piggyvest';
  return undefined;
}
