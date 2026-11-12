import { CONFIG } from '@/lib/config';
import { isPiggyvestCardOnlyMerchant } from '@/lib/is-piggyvest-card-only-merchant';
import { pickMerchantId } from '@/lib/pick-merchant-id';
import { usePiggyvestPrimaryCapability } from '@/lib/piggyvest-primary-capability';

/**
 * True when a purchase top-up (IMEI check, utilities) will open the
 * card-only store credit sheet: the same rule the wallet's top-up sheet
 * applies, so the purchase screen prefills an amount the card form accepts.
 */
export function useCardOnlyPurchaseTopUp(
  merchantId: string | null | undefined,
  walletIsStoreCredit: boolean
): boolean {
  // Same merchant resolution as the wallet screen the top-up opens.
  const activeMerchantId = pickMerchantId(merchantId, CONFIG.MERCHANT_ID);
  const capability = usePiggyvestPrimaryCapability(activeMerchantId);
  return (
    walletIsStoreCredit ||
    isPiggyvestCardOnlyMerchant(activeMerchantId, capability)
  );
}
