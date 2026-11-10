import type { ContributionRail } from './savings/stored-contribution-operation';

export const EARLIER_CONTRIBUTION_CHECKING_MESSAGE =
  'We are checking your earlier contribution. Please try again later.';

export type WalletSavingsRailPlan =
  | { kind: 'check-primary' }
  | { kind: 'blocked' }
  | { kind: 'submit'; rail: ContributionRail };

/**
 * Decides how a wallet-screen contribution proceeds. A stored operation id is
 * bound to the rail of the attempt that minted it and never crosses rails
 * (primary and legacy dedupe independently, so crossing could debit twice):
 * - no stored id: start on the rail the customer is on now.
 * - primary id: primary status is authoritative; if the merchant is no longer
 *   primary the id is kept and nothing is submitted.
 * - legacy id: resubmitted on legacy only, even once the merchant is primary.
 * - unrecorded id (before the rail was stored): primary checks it first, a
 *   non-primary merchant can only hold a legacy id.
 */
export function planWalletSavingsRail(input: {
  hasStoredId: boolean;
  isPrimary: boolean;
  storedRail: ContributionRail | null;
}): WalletSavingsRailPlan {
  if (!input.hasStoredId) {
    return { kind: 'submit', rail: input.isPrimary ? 'primary' : 'legacy' };
  }
  if (input.storedRail === 'legacy') return { kind: 'submit', rail: 'legacy' };
  if (input.storedRail === 'primary' || input.isPrimary) {
    return input.isPrimary ? { kind: 'check-primary' } : { kind: 'blocked' };
  }
  return { kind: 'submit', rail: 'legacy' };
}
