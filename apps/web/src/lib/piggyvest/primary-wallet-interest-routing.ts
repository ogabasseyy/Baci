import 'server-only';
import { piggyvestPrimaryWalletInterestReadbackSchema as readbackSchema } from '@/schemas/piggyvest-primary-wallet-onboarding';

/**
 * What a main-wallet readback proves about its interest routing.
 *
 * PiggyVest fixes a wallet's interest settings when the customer is created,
 * so reading the created wallet back (GET /wallet/:id, which exposes
 * `interest_enabled` and `interest_payout_wallet`: proof p7, 2026-10-31) is
 * the only evidence that main-wallet interest reaches the Ogabassey wallet.
 *
 * - `routed`: the wallet we were given, accruing, paying the configured wallet.
 * - `contradicted`: a readable answer that can never become routed: another
 *   wallet, customer or business, an unreadable identity, or a different
 *   payout wallet. The setting is immutable, so it needs review.
 * - `unsettled`: consistent so far, but accrual or the payout is not (yet)
 *   shown. A wallet created moments ago may still be settling; a customer
 *   created before routing existed never will. The caller tells them apart.
 * - `unreadable`: the read itself failed. Nothing was learned.
 */
export type PrimaryWalletInterestRouting =
  | 'routed'
  | 'contradicted'
  | 'unsettled'
  | 'unreadable';

export async function readPrimaryWalletInterestRouting(input: {
  walletId: string;
  customerId: string;
  businessId: string;
  payoutWalletId: string;
  retrieveWallet: (walletId: string) => Promise<unknown>;
}): Promise<PrimaryWalletInterestRouting> {
  let response: unknown;
  try {
    response = await input.retrieveWallet(input.walletId);
  } catch {
    // Timeouts, transport failures and provider errors all land here, and
    // a 400 on this read is not a creation verdict: the customer exists.
    return 'unreadable';
  }
  const parsed = readbackSchema.safeParse(response);
  if (!parsed.success) return 'contradicted';
  const wallet = parsed.data;
  if (
    wallet.id !== input.walletId ||
    wallet.api_customer_id !== input.customerId ||
    wallet.business_id !== input.businessId
  )
    return 'contradicted';
  const payout = wallet.interest_payout_wallet ?? null;
  if (payout !== null && payout !== input.payoutWalletId) return 'contradicted';
  return payout === input.payoutWalletId && wallet.interest_enabled === true
    ? 'routed'
    : 'unsettled';
}
