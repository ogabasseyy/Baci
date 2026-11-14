import type { SettledPrimaryFundingAccount } from './resolve-wallet-funding-account';
import { primaryBalanceField } from './wallet-primary-balance';

/**
 * Marks a PiggyVest customer whose primary wallet the server confirmed but
 * whose account or balance isn't ready yet. Purchase screens treat it like
 * an unknown verdict: a bank transfer would land in PiggyVest savings once
 * the account exists, never in the store credit a purchase spends.
 */
export function primaryPendingField(primary: SettledPrimaryFundingAccount): {
  primary_pending?: true;
} {
  return primary.status === 'ready' &&
    primaryBalanceField(primary).primary_balance_kobo === undefined
    ? { primary_pending: true }
    : {};
}
