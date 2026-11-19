import { piggyvestInterestPayoutWalletIdSchema } from '@/schemas/piggyvest-primary-wallet-onboarding';
import { piggyvestProviderIdSchema } from '@/schemas/piggyvest-provider-id';

// Exceeds the 512-char limit in piggyvestProviderIdSchema without control
// bytes, so it can never equal a parsed wallet's api_customer_id.
const UNMATCHABLE_OWNER_ID = 'invalid-interest-wallet-owner-'.repeat(20);

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
 * PIGGYVEST_INTEREST_WALLET_OWNER_ID: optional, and only for a customer-owned
 * interest wallet. Set, it is the PiggyVest customer id that owns Ogabassey's
 * interest wallet (its api_customer_id) and the wallet must match it exactly,
 * a positive proof of ownership rather than "not this customer". Unset (or
 * blank), the interest wallet must instead be a business-owned wallet in this
 * business with no API customer, such as the main-wallet interest payout
 * wallet; a customer-owned wallet is then refused. Set but invalid answers an
 * id no wallet can carry, so nothing is sent rather than falling back to the
 * business-wallet rule. Either way the database's wallet and
 * PIGGYVEST_INTEREST_WALLET_ID must still agree.
 */
export function readGoalInterestWalletOwnerId(
  env: NodeJS.ProcessEnv = process.env
): string | null {
  const raw = env.PIGGYVEST_INTEREST_WALLET_OWNER_ID?.trim();
  if (raw === undefined || raw === '') return null;
  const parsed = piggyvestProviderIdSchema.safeParse(raw);
  return parsed.success ? parsed.data : UNMATCHABLE_OWNER_ID;
}

export function readPrimaryInterestPayoutWalletId(
  env: NodeJS.ProcessEnv = process.env
): string | null {
  const parsed = piggyvestInterestPayoutWalletIdSchema.safeParse(
    env.PIGGYVEST_PRIMARY_INTEREST_PAYOUT_WALLET_ID
  );
  return parsed.success ? parsed.data : null;
}
