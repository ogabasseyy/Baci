import type { WalletActiveSavingsGoal } from '@/hooks/wallet-query';
import { shownGoalSetupPhase } from './shown-goal-setup-phase';
import { useGoalSetupScope } from './use-goal-setup-scope';
import { useGoalWalletSetupPoll } from './use-goal-wallet-setup-poll';
import type { SavingsPlanFundingPhase } from './use-savings-plan-funding';
import { useSavingsPlanFunding } from './use-savings-plan-funding';

export type GoalCardSetupState =
  | 'checking'
  | 'getting_ready'
  | 'needs_setup'
  | 'needs_help'
  | null;

/**
 * What the plan card says for a setup status. Only a confirmed-ready plan
 * gets the "Add to savings" invitation (null); while the status is unknown
 * (loading, or the read failed) the card stays neutral.
 */
export function goalCardSetupStateFor(
  phase: SavingsPlanFundingPhase
): GoalCardSetupState {
  if (phase === 'ready') return null;
  if (phase === 'pending' || phase === 'setup_retryable')
    return 'getting_ready';
  if (phase === 'not_started') return 'needs_setup';
  if (phase === 'unavailable') return 'needs_help';
  return 'checking';
}

/**
 * Whether the wallet's plan card should show the plan's setup instead of
 * inviting a first contribution. Only an active manual plan on a PiggyVest
 * primary merchant is checked; it keeps checking while the plan is getting
 * ready, and shares what it learns with the savings sheet.
 */
export function useGoalCardSetupState(
  goal: WalletActiveSavingsGoal,
  /** The savings sheet is open and checks this goal itself: don't double up. */
  pausePolling = false
): GoalCardSetupState {
  // The same key the savings sheet uses, so both read one shared memory.
  const { checked, merchantId, scopeKey, userId } = useGoalSetupScope(goal);
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
  // While the sheet checks the same plan the card sends no reads of its own,
  // but still reports a slow setup it already knows about, so the shared
  // notice is there when the sheet opens.
  useGoalWalletSetupPoll({
    phase: !checked ? 'idle' : phase === 'setup_retryable' ? 'pending' : phase,
    readsPaused: pausePolling,
    scopeKey,
    reread: funding.fetchExistingPlanFunding,
    pendingSince: goal.created_at ? Date.parse(goal.created_at) : null,
  });
  return checked ? goalCardSetupStateFor(phase) : null;
}
