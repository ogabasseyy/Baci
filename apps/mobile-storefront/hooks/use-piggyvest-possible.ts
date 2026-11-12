import { CONFIG } from '@/lib/config';
import { pickMerchantId } from '@/lib/pick-merchant-id';
import { usePiggyvestPrimaryCapability } from '@/lib/piggyvest-primary-capability';

/**
 * False only once the server rules PiggyVest out for this merchant. Purchase
 * screens hold wallet bank transfers while a wallet load or refresh is
 * unsettled only when PiggyVest is possible, so merchants without it keep
 * today's behaviour exactly.
 */
export function usePiggyvestPossible(
  merchantId: string | null | undefined
): boolean {
  // Same merchant resolution as the wallet reads.
  const activeMerchantId = pickMerchantId(merchantId, CONFIG.MERCHANT_ID);
  return usePiggyvestPrimaryCapability(activeMerchantId) !== false;
}
