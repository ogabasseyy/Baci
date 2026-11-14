import { usePiggyvestCapabilityNow } from '@/hooks/use-piggyvest-capability-now';
import { isPiggyvestPrimaryMerchant } from '@/lib/is-piggyvest-primary-merchant';

/**
 * True when the PiggyVest read failed (server unreachable) at the merchant
 * where PiggyVest can be on, and it isn't ruled out (Fable walk 10): the
 * wallet shows a "can't check right now" state instead of the goals total
 * and never offers to create an account. Other stores keep today's wallet
 * (owner decision 2026-11-13).
 */
export function useWalletPrimaryUnknown(
  merchantId: string | undefined,
  primaryUnreadable: boolean | undefined
): boolean {
  const verdictNow = usePiggyvestCapabilityNow(merchantId);
  return (
    primaryUnreadable === true &&
    isPiggyvestPrimaryMerchant(merchantId) &&
    verdictNow !== false
  );
}
