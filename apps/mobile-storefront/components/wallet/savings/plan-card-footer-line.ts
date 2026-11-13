import type { GoalCardSetupState } from './use-goal-card-setup-state';

/**
 * The plan card's footer line: the plan's setup state when its savings
 * wallet is not confirmed ready, otherwise a nudge for a plan with nothing
 * saved yet (null for one already started).
 */
export function planCardFooterLine(
  setupState: GoalCardSetupState,
  hasStarted: boolean
): string | null {
  if (setupState === 'checking') return 'Checking your plan…';
  if (setupState === 'getting_ready') return 'Getting your plan ready';
  if (setupState === 'needs_setup') return 'Finish setting up your plan';
  if (setupState === 'needs_help') return 'We couldn’t finish your plan setup';
  return hasStarted ? null : 'Start with your first contribution';
}
