import { lastGoalSetupPhase } from './goal-setup-memory';
import type { SavingsPlanFundingPhase } from './use-savings-plan-funding';

/**
 * The setup status to show while a fresh read is in flight: what this app
 * last learned about the goal when that was "ready" or "still being set up"
 * (a stalled setup shows as still being set up, so nothing is retried on
 * stale news). Anything else shows as it is.
 */
export function shownGoalSetupPhase(
  phase: SavingsPlanFundingPhase,
  scopeKey: string
): SavingsPlanFundingPhase {
  if (phase !== 'idle' && phase !== 'loading') return phase;
  const last = lastGoalSetupPhase(scopeKey);
  if (last === 'ready') return 'ready';
  if (last === 'pending' || last === 'setup_retryable') return 'pending';
  return phase;
}
