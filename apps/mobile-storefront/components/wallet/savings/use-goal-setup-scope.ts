import type { WalletActiveSavingsGoal } from '@/hooks/wallet-query';
import { CONFIG } from '@/lib/config';
import { isPiggyvestPrimaryMerchant } from '@/lib/is-piggyvest-primary-merchant';
import { pickMerchantId } from '@/lib/pick-merchant-id';
import { useAuthStore } from '@/stores/auth-store';

/**
 * Who and what a goal's setup status belongs to. `checked` is true only for
 * an active manual plan on a PiggyVest primary merchant with a signed-in
 * account: only those plans have a savings wallet that is set up after
 * creation. `scopeKey` is the account + merchant + goal key every setup
 * check and the shared setup memory use.
 */
export function useGoalSetupScope(goal: WalletActiveSavingsGoal | null) {
  const userId = useAuthStore((state) => state.user?.id) ?? '';
  const storeMerchantId = useAuthStore((state) => state.merchantId);
  const merchantId = pickMerchantId(storeMerchantId, CONFIG.MERCHANT_ID) ?? '';
  const checked =
    goal !== null &&
    userId !== '' &&
    isPiggyvestPrimaryMerchant(merchantId) &&
    goal.source_mode === 'manual' &&
    goal.status === 'active';
  return {
    checked,
    merchantId,
    scopeKey: JSON.stringify([userId, merchantId, goal?.id ?? '']),
    userId,
  };
}
