import { usePiggyvestCapabilityNow } from '@/hooks/use-piggyvest-capability-now';
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
 * not yet observed), the wallet owner is unresolved where PiggyVest is
 * possible, or the merchant's purchase top-ups are card-only.
 */
export function useCardOnlyPurchaseTopUp(
  merchantId: string | null | undefined,
  wallet: WalletPrimaryLike | null | undefined
): boolean {
  // Same merchant resolution as the wallet screen the top-up opens.
  const activeMerchantId = pickMerchantId(merchantId, CONFIG.MERCHANT_ID);
  const capability = usePiggyvestPrimaryCapability(activeMerchantId);
  const verdictNow = usePiggyvestCapabilityNow(activeMerchantId);
  return (
    // A live ruling-out overrides a stale cached PiggyVest wallet (Codex).
    (verdictNow !== false &&
      (isWalletStoreCredit(wallet) || isWalletPrimaryUnknown(wallet))) ||
    // No customer row yet: unclassified where PiggyVest is possible (Codex).
    (wallet?.owner_unresolved === true && capability !== false) ||
    isPiggyvestCardOnlyMerchant(activeMerchantId, capability) ||
    // No verdict yet: same rule as the Add money sheet (Codex).
    (capability === null && verdictNow === null)
  );
}
