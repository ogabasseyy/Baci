import { CONFIG } from '@/lib/config';
import { isStoreCreditPurchaseCopy } from '@/lib/is-store-credit-purchase-copy';
import { pickMerchantId } from '@/lib/pick-merchant-id';
import type { WalletPrimaryLike } from '@/lib/wallet-store-credit';
import { usePiggyvestCapabilityNow } from './use-piggyvest-capability-now';

/**
 * Purchase-screen "Store credit" wording that follows the live verdict
 * (Codex): after a rollback to "not ready" whose wallet reload failed, a
 * stale PiggyVest-shaped cache no longer labels the legacy wallet as store
 * credit.
 */
export function useStoreCreditPurchaseCopy(
  merchantId: string | null | undefined,
  wallet: WalletPrimaryLike | null | undefined
): boolean {
  const verdict = usePiggyvestCapabilityNow(
    pickMerchantId(merchantId, CONFIG.MERCHANT_ID)
  );
  return verdict !== false && isStoreCreditPurchaseCopy(wallet);
}
