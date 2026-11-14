import { readPiggyvestCapabilityNow } from '@/lib/read-piggyvest-capability-now';

/**
 * Why Place Order switched "Bank transfer to wallet" to a one-time
 * transfer: PiggyVest is on for this merchant (by design), or the app
 * couldn't confirm the wallet in time (Muse: say so, don't call it
 * unavailable).
 */
export type WalletTransferFallback = 'piggyvest' | 'unconfirmed';

/** Judged for the merchant the order was submitted to (Muse), not a live
 * store read that a mid-submit merchant switch could change. */
export function walletTransferFallbackReason(
  merchantId: string | null | undefined
): WalletTransferFallback {
  return readPiggyvestCapabilityNow(merchantId) === true
    ? 'piggyvest'
    : 'unconfirmed';
}

/** Route param to reason; the original "1" meant the PiggyVest case. */
export function parseWalletTransferFallback(
  raw: string | string[] | undefined
): WalletTransferFallback | undefined {
  // Router params can arrive as an array (repeated query key, Muse): the
  // first value decides, so the notice is never silently dropped.
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (value === 'unconfirmed') return 'unconfirmed';
  if (value === 'piggyvest' || value === '1') return 'piggyvest';
  return undefined;
}
