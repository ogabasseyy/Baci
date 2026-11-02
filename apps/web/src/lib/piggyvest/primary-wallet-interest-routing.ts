import 'server-only';
import { piggyvestPrimaryWalletInterestReadbackSchema as readbackSchema } from '@/schemas/piggyvest-primary-wallet-onboarding';

const identitySchema = readbackSchema.pick({
  id: true,
  api_customer_id: true,
  business_id: true,
});
const interestSchema = readbackSchema.pick({
  interest_enabled: true,
  interest_payout_wallet: true,
});

/**
 * What a main-wallet readback proves about its interest routing.
 *
 * PiggyVest fixes a wallet's interest settings when the customer is created,
 * so reading the created wallet back (GET /wallet/:id, which exposes
 * `interest_enabled` and `interest_payout_wallet`: proof p7, 2026-10-31) is
 * the only evidence that main-wallet interest reaches the Ogabassey wallet.
 *
 * - `routed`: the wallet we were given, accruing, paying the configured wallet.
 * - `contradicted`: identity is not proven to be the wallet/customer/business
 *   created by this request, so it needs ownership review.
 * - `routing_contradicted`: identity matches, but an immutable interest
 *   setting is wrong, so it needs routing review.
 * - `unsettled`: consistent so far, but accrual or the payout is not shown
 *   yet (absent or null). A wallet created moments ago may still be
 *   settling, so it is never treated as final.
 * - `unreadable`: the read itself failed. Nothing was learned.
 */
export type PrimaryWalletInterestRouting =
  | 'routed'
  | 'contradicted'
  | 'routing_contradicted'
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
  const identity = identitySchema.safeParse(response);
  if (!identity.success) return 'contradicted';
  if (
    identity.data.id !== input.walletId ||
    identity.data.api_customer_id !== input.customerId ||
    identity.data.business_id !== input.businessId
  )
    return 'contradicted';
  const settings = interestSchema.safeParse(response);
  if (!settings.success) return 'routing_contradicted';
  const wallet = settings.data;
  const payout = wallet.interest_payout_wallet ?? null;
  if (payout !== null && payout !== input.payoutWalletId)
    return 'routing_contradicted';
  if (wallet.interest_enabled === false) return 'routing_contradicted';
  return payout === input.payoutWalletId && wallet.interest_enabled === true
    ? 'routed'
    : 'unsettled';
}
