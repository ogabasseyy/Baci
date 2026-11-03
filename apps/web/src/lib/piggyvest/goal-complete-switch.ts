/**
 * Complete-only emergency off switch.
 *
 * PIGGYVEST_GOAL_COMPLETE_DISABLED: unset or exactly "false" means completing
 * a goal is allowed (the default, so the master kill switch and the new-money
 * flags never trap a customer's own money). Any other value, including
 * "true", "1" or blank, refuses NEW completes, including the PIN step that
 * starts one, so a typo fails closed. It never gates status checks,
 * settlement or reconciliation of completes already dispatched. Read from
 * process.env directly on purpose: it is not declared in env.ts.
 */
export type GoalCompleteSwitchEnv = Readonly<
  Record<string, string | undefined>
>;

export function isPiggyvestGoalCompleteDisabled(
  env: GoalCompleteSwitchEnv = process.env
): boolean {
  const value = env.PIGGYVEST_GOAL_COMPLETE_DISABLED;
  return !(value === undefined || value === 'false');
}
