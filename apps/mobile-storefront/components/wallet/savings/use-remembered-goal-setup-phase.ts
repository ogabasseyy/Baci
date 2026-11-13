import { useSyncExternalStore } from 'react';
import {
  lastGoalSetupPhase,
  subscribeGoalSetupMemory,
} from './goal-setup-memory';
import type { SavingsPlanFundingPhase } from './use-savings-plan-funding';

/**
 * The goal's last settled setup status this app run has learned (from the
 * wallet card or the savings sheet), kept up to date as either learns more.
 * Null until one has.
 */
export function useRememberedGoalSetupPhase(
  scopeKey: string
): SavingsPlanFundingPhase | null {
  return useSyncExternalStore(subscribeGoalSetupMemory, () =>
    lastGoalSetupPhase(scopeKey)
  );
}
