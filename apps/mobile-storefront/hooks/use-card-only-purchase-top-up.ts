import { CONFIG } from '@/lib/config';
import { isPiggyvestCardOnlyMerchant } from '@/lib/is-piggyvest-card-only-merchant';
import { isWalletPrimaryUnknown } from '@/lib/is-wallet-primary-unknown';
import { pickMerchantId } from '@/lib/pick-merchant-id';
import { usePiggyvestPrimaryCapability } from '@/lib/piggyvest-primary-capability';
import {
  isWalletStoreCredit,
  type WalletPrimaryLike,
} from '@/lib/wallet-store-credit';

/**
 * True when a purchase top-up (IMEI check, utilities) should prefill an
 * amount the card form accepts: the customer spends store credit, the
 * PiggyVest read is unknown or pending (Codex: even at a rollout merchant
 * not yet observed), or the merchant's purchase top-ups are card-only.
 */
export function useCardOnlyPurchaseTopUp(
  merchantId: string | null | undefined,
  wallet: WalletPrimaryLike | null | undefined
): boolean {
  // Same merchant resolution as the wallet screen the top-up opens.
  const activeMerchantId = pickMerchantId(merchantId, CONFIG.MERCHANT_ID);
  const capability = usePiggyvestPrimaryCapability(activeMerchantId);
  return (
    isWalletStoreCredit(wallet) ||
    isWalletPrimaryUnknown(wallet) ||
    isPiggyvestCardOnlyMerchant(activeMerchantId, capability)
  );
}
