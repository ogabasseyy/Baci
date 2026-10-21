import { VTU_CANONICAL_IDEMPOTENCY_KEY_HEADER } from '@baci/shared/lib';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { authenticateApiRequest } from '@/lib/api-auth';
import { createAdminClient } from '@/lib/supabase/admin';
import { discardOrphanedClaimTransaction } from '@/lib/vtu-claim-orphan-discard';
import { fulfillReplayVtuTransaction } from '@/lib/vtu-replay-fulfillment';
import type { VtuWalletOnlyChargeInput } from '@/schemas/vtu-wallet-only';

type JoinAuthUser = NonNullable<
  Awaited<ReturnType<typeof authenticateApiRequest>>['user']
>;

/** claim_vtu_intent join mapping (minimal RPC-row surface). */
export interface JoinedVtuClaimMapping {
  transaction_id: string;
  idempotency_key: string;
}

/**
 * Loser path (split from the wallet-only route per the 300-line
 * boundary): another key owns this intent's transaction. Discards
 * our prepared row (guarded pending→failed + no-collection
 * marker; no reversal — prepare doesn't debit), then replays the
 * winner. Same-scope/same-fingerprint by RPC construction, so no
 * ownership re-check is needed.
 */
export async function fulfillJoinedVtuClaim({
  authSupabase,
  userSupabase,
  user,
  input,
  customerId,
  merchantId,
  preparedTransactionId,
  claim,
  requestFingerprint,
  userId,
}: {
  authSupabase: SupabaseClient;
  userSupabase: SupabaseClient;
  user: JoinAuthUser;
  input: VtuWalletOnlyChargeInput;
  customerId: string;
  merchantId: string;
  preparedTransactionId: string;
  claim: JoinedVtuClaimMapping;
  requestFingerprint: string;
  userId: string;
}) {
  await discardOrphanedClaimTransaction({
    context: 'join',
    merchantId,
    supabase: userSupabase,
    transactionId: preparedTransactionId,
    userId,
  });
  // Joins should be rare (registries normally reuse keys); a
  // join storm signals client key churn — investigate the
  // registry, not the claim. Transaction IDs only: the winner
  // key is an unguessable replay credential and must never
  // reach logs (Codex R2 P2, Muse R108).
  console.info('VTU intent claim joined in-flight transaction:', {
    preparedTransactionId,
    winnerTransactionId: claim.transaction_id,
  });
  const replayResponse = await fulfillReplayVtuTransaction({
    authSupabase,
    input,
    keyRow: {
      key: claim.idempotency_key,
      vtu_transaction_id: claim.transaction_id,
      customer_id: customerId,
      merchant_id: merchantId,
      request_fingerprint: requestFingerprint,
    },
    supabase: createAdminClient(),
    user,
  });
  // Winner-key wire: the loser key maps to the winner
  // server-side (loser-key retries replay), and clients adopt
  // the winner key for subsequent retries so every attempt
  // converges on one key instead of re-preparing + orphaning
  // per attempt. Same-scope by RPC construction — nothing
  // cross-principal is disclosed.
  replayResponse.headers.set(
    VTU_CANONICAL_IDEMPOTENCY_KEY_HEADER,
    claim.idempotency_key
  );
  return replayResponse;
}
