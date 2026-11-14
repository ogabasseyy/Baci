import { usePiggyvestCapabilityNow } from '@/hooks/use-piggyvest-capability-now';
import { CONFIG } from '@/lib/config';
import { isPiggyvestPrimaryMerchant } from '@/lib/is-piggyvest-primary-merchant';
import { pickMerchantId } from '@/lib/pick-merchant-id';
import { wasPiggyvestLastRuledOut } from '@/lib/piggyvest-primary-capability-cache';
import { useAuthStore } from '@/stores/auth-store';

/**
 * True when a saved PiggyVest account number is on screen but the store's
 * PiggyVest status can't be checked yet (cold launch with the server down,
 * walk 14): the number is shown as the last known one instead of
 * "Checking your account…" forever. Only at the PiggyVest store, and never
 * after a rollback whose ruling-out just expired (that stays hidden).
 */
export function usePiggyvestAccountUnconfirmed(
  provider: string | null | undefined
): boolean {
  const merchantId = pickMerchantId(
    useAuthStore((state) => state.merchantId),
    CONFIG.MERCHANT_ID
  );
  const verdict = usePiggyvestCapabilityNow(merchantId);
  return (
    provider === 'piggyvest' &&
    !!merchantId &&
    isPiggyvestPrimaryMerchant(merchantId) &&
    verdict === null &&
    !wasPiggyvestLastRuledOut(merchantId)
  );
}
