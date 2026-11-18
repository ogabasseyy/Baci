import { useSyncExternalStore } from 'react';
import {
  goalSetupPhaseUpdatedAt,
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

/** When that remembered status last changed (0 if never), kept up to date. */
export function useRememberedGoalSetupPhaseAt(scopeKey: string): number {
  return useSyncExternalStore(subscribeGoalSetupMemory, () =>
    goalSetupPhaseUpdatedAt(scopeKey)
  );
}
