import { usePiggyvestCapabilityNow } from '@/hooks/use-piggyvest-capability-now';
import { isPiggyvestPrimaryMerchant } from '@/lib/is-piggyvest-primary-merchant';
import { wasPiggyvestLastRuledOut } from '@/lib/piggyvest-primary-capability-cache';

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
  // A rollback whose ruling-out just expired is not "unknown": PiggyVest
  // stays off until a fresh positive verdict (Codex).
  return (
    primaryUnreadable === true &&
    isPiggyvestPrimaryMerchant(merchantId) &&
    verdictNow !== false &&
    !(
      verdictNow === null &&
      !!merchantId &&
      wasPiggyvestLastRuledOut(merchantId)
    )
  );
}
