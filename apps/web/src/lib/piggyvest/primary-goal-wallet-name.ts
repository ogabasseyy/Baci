import 'server-only';
import { createHash } from 'node:crypto';
import { PIGGYVEST_SUBACCOUNT_NAME_MAX_CHARACTERS } from './provider-wallet-name.constants';

/**
 * Deterministic PiggyVest name for a primary savings goal wallet:
 * 'baci-save-' plus the first 32 hex characters of
 * sha256('<integrationId>:<goalId>') over lowercase UUID text. 42
 * characters, inside the provider's 50-character limit, and unique per
 * integration and goal. The database builds the identical name in
 * piggyvest_primary.prepare_goal_wallet (migration 20261031221500), so the
 * two must change together.
 */
export function buildPrimaryGoalWalletName(
  integrationId: string,
  goalId: string
): string {
  const digest = createHash('sha256')
    .update(`${integrationId.toLowerCase()}:${goalId.toLowerCase()}`)
    .digest('hex');
  const name = `baci-save-${digest.slice(0, 32)}`;
  if (name.length > PIGGYVEST_SUBACCOUNT_NAME_MAX_CHARACTERS)
    throw new Error('Goal wallet name exceeds the PiggyVest limit');
  return name;
}

/**
 * Whether a goal intent's stored wallet name is this goal's. New intents
 * carry the current name; the pre-short-name 'baci-save:<integration>:<goal>'
 * survives (migration 20261031221500) only on intents that already hold a
 * provider wallet, so it is accepted only there.
 */
export function isPrimaryGoalWalletName(
  storedName: string,
  goal: { integrationId: string; goalId: string; hasProviderWallet: boolean }
): boolean {
  if (
    storedName === buildPrimaryGoalWalletName(goal.integrationId, goal.goalId)
  )
    return true;
  return (
    goal.hasProviderWallet &&
    storedName.toLowerCase() ===
      `baci-save:${goal.integrationId.toLowerCase()}:${goal.goalId.toLowerCase()}`
  );
}
