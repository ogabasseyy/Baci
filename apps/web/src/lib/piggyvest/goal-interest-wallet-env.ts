import { piggyvestProviderIdSchema } from '@/schemas/piggyvest-provider-id';

/**
 * PIGGYVEST_INTEREST_WALLET_ID: Ogabassey's PiggyVest wallet for forfeited
 * goal interest, set in the deployment. It must equal the wallet configured in
 * the database (goal_interest_forfeit_wallets) before any interest is sent, so
 * one mistyped setting can never send interest to someone else's wallet.
 * Unset or invalid means no interest transfer is sent.
 */
export function readGoalInterestWalletId(
  env: NodeJS.ProcessEnv = process.env
): string | null {
  const parsed = piggyvestProviderIdSchema.safeParse(
    env.PIGGYVEST_INTEREST_WALLET_ID?.trim()
  );
  return parsed.success ? parsed.data : null;
}

/**
 * PIGGYVEST_INTEREST_WALLET_OWNER_ID: the PiggyVest customer id that owns
 * Ogabassey's interest wallet (its api_customer_id). The wallet must match it
 * exactly, a positive proof of ownership rather than "not this customer".
 * Unset or invalid means no interest transfer is sent.
 */
export function readGoalInterestWalletOwnerId(
  env: NodeJS.ProcessEnv = process.env
): string | null {
  const parsed = piggyvestProviderIdSchema.safeParse(
    env.PIGGYVEST_INTEREST_WALLET_OWNER_ID?.trim()
  );
  return parsed.success ? parsed.data : null;
}
