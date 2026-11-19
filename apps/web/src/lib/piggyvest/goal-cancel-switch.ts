/**
 * Cancel-only emergency off switch.
 *
 * PIGGYVEST_GOAL_CANCEL_DISABLED: unset or exactly "false" means cancel to main
 * is allowed (the default, so a customer is never trapped by the master kill
 * switch or the new-money flags). Any other value, including "true", "1" or
 * blank, refuses NEW cancels so a typo fails closed. It never gates status
 * checks, settlement or reconciliation of cancels already dispatched.
 */
export type GoalCancelSwitchEnv = Readonly<Record<string, string | undefined>>;

export function isPiggyvestGoalCancelDisabled(
  env: GoalCancelSwitchEnv = process.env
): boolean {
  const value = env.PIGGYVEST_GOAL_CANCEL_DISABLED;
  return !(value === undefined || value === 'false');
}
