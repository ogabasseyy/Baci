/**
 * Master kill switch for PiggyVest new-money paths.
 *
 * PIGGYVEST_KILL_SWITCH: unset or exactly "false" means not killed; any other
 * value (including "true", "1", blank) kills, so a typo fails closed. It only
 * gates NEW work: cancel to main and reconcile (and the drain/recovery readers
 * behind them) never consult it, so nobody is trapped and provider-accepted
 * operations still settle.
 */

/** Any string map works, so tests need not satisfy the full ProcessEnv shape. */
export type PiggyvestSwitchEnv = Readonly<Record<string, string | undefined>>;

export function isPiggyvestKilled(
  env: PiggyvestSwitchEnv = process.env
): boolean {
  const value = env.PIGGYVEST_KILL_SWITCH;
  return !(value === undefined || value === 'false');
}
