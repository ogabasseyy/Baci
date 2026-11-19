import { CONFIG } from '@/lib/config';
import { isPiggyvestPrimaryMerchant } from '@/lib/is-piggyvest-primary-merchant';
import { pickMerchantId } from '@/lib/pick-merchant-id';
import { readObservedPiggyvestPrimaryCapability } from '@/lib/piggyvest-primary-capability-cache';

/**
 * The current PiggyVest verdict for this merchant, read from the verdict
 * cache at call time: true (on), false (ruled out, still current) or null
 * (unknown: never probed, expired, or the probe failed). No merchant at
 * all is false, like the capability hook.
 *
 * Owner decision (2026-11-13): PiggyVest is only for the Ogabassey pilot
 * merchant. An unknown verdict therefore counts as "ruled out" for every
 * other merchant, so none of the fail-closed holds touch them; only the
 * pilot keeps holding while its verdict is unknown.
 */
export function readPiggyvestCapabilityNow(
  merchantId: string | null | undefined
): boolean | null {
  const activeMerchantId = pickMerchantId(merchantId, CONFIG.MERCHANT_ID);
  if (!activeMerchantId) {
    return false;
  }
  const observed = readObservedPiggyvestPrimaryCapability(activeMerchantId);
  if (observed !== null) return observed;
  return isPiggyvestPrimaryMerchant(activeMerchantId) ? null : false;
}
