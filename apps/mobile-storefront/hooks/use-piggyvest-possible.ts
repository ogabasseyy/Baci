import { CONFIG } from '@/lib/config';
import { isPiggyvestPrimaryMerchant } from '@/lib/is-piggyvest-primary-merchant';
import { pickMerchantId } from '@/lib/pick-merchant-id';
import { usePiggyvestPrimaryCapability } from '@/lib/piggyvest-primary-capability';

/**
 * True when PiggyVest is on, or still unknown for the Ogabassey pilot. Purchase
 * screens hold wallet bank transfers while a wallet load or refresh is
 * unsettled only when PiggyVest is possible, so merchants without it keep
 * today's behaviour exactly.
 */
export function usePiggyvestPossible(
  merchantId: string | null | undefined
): boolean {
  // Same merchant resolution as the wallet reads.
  const activeMerchantId = pickMerchantId(merchantId, CONFIG.MERCHANT_ID);
  const capability = usePiggyvestPrimaryCapability(activeMerchantId);
  // Owner decision (2026-11-13): only the Ogabassey pilot can be PiggyVest,
  // so an unknown verdict means "possible" for the pilot alone.
  return (
    capability === true ||
    (capability === null && isPiggyvestPrimaryMerchant(activeMerchantId))
  );
}
