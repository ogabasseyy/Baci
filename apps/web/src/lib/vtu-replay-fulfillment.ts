import type { SupabaseClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import type { authenticateApiRequest } from '@/lib/api-auth';
import { fulfillPendingVtuTransaction } from '@/lib/vtu-fulfillment';
import { mapFulfillmentToResponse } from '@/lib/vtu-fulfillment-response';
import type { ExistingIdempotencyRow } from '@/lib/vtu-idempotency-key-lookup';
import { overlayReplayAttributes } from '@/lib/vtu-replay-attribute-overlay';
import { verifyReplayTransactionBinding } from '@/lib/vtu-replay-binding';
import { claimReplayCustomerOwner } from '@/lib/vtu-replay-owner-claim';
import type { VtuWalletOnlyChargeInput } from '@/schemas/vtu-wallet-only';

type ReplayAuthUser = NonNullable<
  Awaited<ReturnType<typeof authenticateApiRequest>>['user']
>;

/**
 * Shared replay tail (Muse R128 MEDIUM extraction): binding → owner
 * claim → current-attempt overlay → fulfill. Moved verbatim from the
 * wallet-only route's two replay sites (main replay + PK-race winner
 * replay), which ran identical sequences — the owner claim between
 * binding and overlay is the only addition. Guards (customer,
 * merchant, fingerprint) stay at the call sites: they compare against
 * different baselines (requesting ownership vs the prepared row).
 */
export async function fulfillReplayVtuTransaction({
  authSupabase,
  input,
  keyRow,
  supabase,
  user,
}: {
  authSupabase: SupabaseClient;
  input: VtuWalletOnlyChargeInput;
  keyRow: ExistingIdempotencyRow;
  supabase: SupabaseClient;
  user: ReplayAuthUser;
}) {
  // Owner binding: the key row's owner was validated above;
  // the transaction row must match before fulfilling.
  const binding = await verifyReplayTransactionBinding({
    supabase,
    keyRow,
  });
  if ('error' in binding) {
    return NextResponse.json({ error: binding.error }, { status: 400 });
  }
  // Owner claim: legacy/manual key rows can reference an unlinked
  // guest customer. Fulfilling without binding would debit a row
  // never linked to the caller (and the overlay below would silently
  // no-op on it). Runs after ALL guards (R86: never link before
  // rejection) and before the overlay needs customers.user_id.
  const claimedOwner = await claimReplayCustomerOwner({
    customerId: keyRow.customer_id,
    supabase,
    user,
  });
  if (!claimedOwner) {
    return NextResponse.json(
      {
        error:
          'Idempotency-Key owner is unavailable. Generate a fresh key for a new purchase.',
      },
      { status: 400 }
    );
  }
  // Current-attempt overlay: the retry carries the freshest
  // phone/reference; attempt-1's snapshot must not win. Runs on
  // the AUTHENTICATED user client (never service role for this
  // user-facing write): the patch RPC enforces row ownership
  // from the JWT, and the refresh pre-read resolves through the
  // ownership-scoped RPC (no customer table projection).
  await overlayReplayAttributes({
    supabase: authSupabase,
    transactionId: keyRow.vtu_transaction_id,
    customerPhone: input.customerPhone,
    validationReference: input.validationReference,
  });
  const replayedFulfillment = await fulfillPendingVtuTransaction({
    supabase,
    transactionId: keyRow.vtu_transaction_id,
  });
  return mapFulfillmentToResponse(replayedFulfillment);
}
