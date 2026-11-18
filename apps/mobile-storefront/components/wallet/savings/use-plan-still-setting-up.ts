import type { WalletActiveSavingsGoal } from '@/hooks/wallet-query';
import { useGoalSetupScope } from './use-goal-setup-scope';
import { useRememberedGoalSetupPhase } from './use-remembered-goal-setup-phase';

/**
 * True while a plan's savings wallet is not yet known to be ready, for a plan
 * whose wallet is set up after creation (see useGoalSetupScope). The wallet
 * card then says "View plan", so the savings sheet is titled to match.
 */
export function usePlanStillSettingUp(
  goal: WalletActiveSavingsGoal | null
): boolean {
  const { checked, scopeKey } = useGoalSetupScope(goal);
  const remembered = useRememberedGoalSetupPhase(scopeKey);
  return checked && remembered !== 'ready';
}
