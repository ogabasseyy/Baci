import { CONFIG } from '@/lib/config';
import { pickMerchantId } from '@/lib/pick-merchant-id';
import { readObservedPiggyvestPrimaryCapability } from '@/lib/piggyvest-primary-capability-cache';

/**
 * The current PiggyVest verdict for this merchant, read from the verdict
 * cache at call time: true (on), false (ruled out, still current) or null
 * (unknown: never probed, expired, or the probe failed). No merchant at
 * all is false, like the capability hook.
 */
export function readPiggyvestCapabilityNow(
  merchantId: string | null | undefined
): boolean | null {
  const activeMerchantId = pickMerchantId(merchantId, CONFIG.MERCHANT_ID);
  if (!activeMerchantId) {
    return false;
  }
  return readObservedPiggyvestPrimaryCapability(activeMerchantId);
}
