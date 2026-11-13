import type { WalletActiveSavingsGoal } from '@/hooks/wallet-query';
import { CONFIG } from '@/lib/config';
import { isPiggyvestPrimaryMerchant } from '@/lib/is-piggyvest-primary-merchant';
import { pickMerchantId } from '@/lib/pick-merchant-id';
import { useAuthStore } from '@/stores/auth-store';
import { shownGoalSetupPhase } from './shown-goal-setup-phase';
import { useGoalWalletSetupPoll } from './use-goal-wallet-setup-poll';
import { useSavingsPlanFunding } from './use-savings-plan-funding';

export type GoalCardSetupState = 'getting_ready' | 'needs_setup' | null;

/**
 * Whether the wallet's plan card should show the plan's setup instead of
 * inviting a first contribution. Only an active manual plan on a PiggyVest
 * primary merchant is checked; it keeps checking while the plan is getting
 * ready, and shares what it learns with the savings sheet.
 */
export function useGoalCardSetupState(
  goal: WalletActiveSavingsGoal
): GoalCardSetupState {
  const userId = useAuthStore((state) => state.user?.id) ?? '';
  const storeMerchantId = useAuthStore((state) => state.merchantId);
  const merchantId = pickMerchantId(storeMerchantId, CONFIG.MERCHANT_ID) ?? '';
  const checked =
    userId !== '' &&
    isPiggyvestPrimaryMerchant(merchantId) &&
    goal.source_mode === 'manual' &&
    goal.status === 'active';
  // The same key the savings sheet uses, so both read one shared memory.
  const scopeKey = JSON.stringify([userId, merchantId, goal.id]);
  const funding = useSavingsPlanFunding({
    activeMerchantId: merchantId,
    goalId: checked ? goal.id : null,
    identityKey: userId,
    loadExisting: checked,
    notFoundMeansNotStarted: true,
  });
  const phase = shownGoalSetupPhase(funding.planFundingPhase, scopeKey);
  // The poll only reads status, so a stalled setup (which the sheet may
  // re-run) keeps being read like a pending one: the card turns back to
  // "Add to savings" on its own once the plan is ready.
  useGoalWalletSetupPoll({
    phase: !checked ? 'idle' : phase === 'setup_retryable' ? 'pending' : phase,
    scopeKey,
    reread: funding.fetchExistingPlanFunding,
  });
  if (!checked) return null;
  if (phase === 'pending' || phase === 'setup_retryable')
    return 'getting_ready';
  if (phase === 'not_started') return 'needs_setup';
  return null;
}
