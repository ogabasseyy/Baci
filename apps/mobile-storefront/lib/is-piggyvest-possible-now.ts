import { CONFIG } from '@/lib/config';
import { pickMerchantId } from '@/lib/pick-merchant-id';
import { readObservedPiggyvestPrimaryCapability } from '@/lib/piggyvest-primary-capability-cache';

/**
 * Call-time twin of usePiggyvestPossible for submit-time checks: a render
 * value goes stale when a cached negative verdict expires mid-submit, so
 * this reads the verdict cache at the moment of the check. False only
 * while the server's ruling-out is still current.
 */
export function isPiggyvestPossibleNow(
  merchantId: string | null | undefined
): boolean {
  const activeMerchantId = pickMerchantId(merchantId, CONFIG.MERCHANT_ID);
  if (!activeMerchantId) {
    return false;
  }
  return readObservedPiggyvestPrimaryCapability(activeMerchantId) !== false;
}
