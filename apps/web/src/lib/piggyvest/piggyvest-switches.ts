/**
 * Master kill switch plus per-feature switches for PiggyVest money paths.
 *
 * Kill switch: PIGGYVEST_KILL_SWITCH. Unset or exactly "false" means not
 * killed; any other value (including "true", "1", blank) kills, so a typo
 * fails closed. Each feature is also on only when its own enable flag is
 * exactly "true". The master switch only gates NEW work: cancel to main and
 * reconcile (and the drain/recovery readers behind them) never consult it,
 * so nobody is trapped and provider-accepted operations still settle.
 */

export const PIGGYVEST_KILL_SWITCH_ENV = 'PIGGYVEST_KILL_SWITCH';

export const PIGGYVEST_FEATURE_FLAGS = {
  wallet: 'PIGGYVEST_PRIMARY_ENABLED',
  deposit_to_goal: 'PIGGYVEST_PRIMARY_SAVINGS_ENABLED',
  goal_provisioning: 'PIGGYVEST_PRIMARY_SAVINGS_PROVISIONING_ENABLED',
  plan_funding: 'PIGGYVEST_SAVINGS_FUNDING_DISPLAY_ENABLED',
  card_checkout: 'PIGGYVEST_PRIMARY_CARD_ENABLED',
  card_custody: 'PIGGYVEST_PRIMARY_CARD_CUSTODY_ENABLED',
  inflows: 'PIGGYVEST_PRIMARY_INFLOWS_ENABLED',
  paid_interest: 'PIGGYVEST_PRIMARY_PAID_INTEREST_ENABLED',
  bank_inbox: 'PIGGYVEST_PRIMARY_BANK_INBOX_ENABLED',
  card_signed_inbox: 'PIGGYVEST_PRIMARY_CARD_SIGNED_INBOX_ENABLED',
  paid_interest_inbox: 'PIGGYVEST_PRIMARY_PAID_INTEREST_INBOX_ENABLED',
} as const;

export type PiggyvestFeature = keyof typeof PIGGYVEST_FEATURE_FLAGS;

export const PIGGYVEST_ALWAYS_AVAILABLE_OPERATIONS = [
  'cancel_to_main',
  'reconcile',
] as const;

export type PiggyvestAlwaysAvailableOperation =
  (typeof PIGGYVEST_ALWAYS_AVAILABLE_OPERATIONS)[number];

export function isPiggyvestKilled(
  env: NodeJS.ProcessEnv = process.env
): boolean {
  const value = env[PIGGYVEST_KILL_SWITCH_ENV];
  return !(value === undefined || value === 'false');
}

export function isPiggyvestFeatureOn(
  feature: PiggyvestFeature,
  env: NodeJS.ProcessEnv = process.env
): boolean {
  return (
    !isPiggyvestKilled(env) && env[PIGGYVEST_FEATURE_FLAGS[feature]] === 'true'
  );
}

export function isPiggyvestOperationAllowed(
  operation: PiggyvestFeature | PiggyvestAlwaysAvailableOperation,
  env: NodeJS.ProcessEnv = process.env
): boolean {
  if (
    (PIGGYVEST_ALWAYS_AVAILABLE_OPERATIONS as readonly string[]).includes(
      operation
    )
  )
    return true;
  return isPiggyvestFeatureOn(operation as PiggyvestFeature, env);
}
