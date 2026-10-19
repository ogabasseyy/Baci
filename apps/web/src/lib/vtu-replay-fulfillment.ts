import type { SupabaseClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import type { authenticateApiRequest } from '@/lib/api-auth';
import { fulfillPendingVtuTransaction } from '@/lib/vtu-fulfillment';
import { mapFulfillmentToResponse } from '@/lib/vtu-fulfillment-response';
import type { ExistingIdempotencyRow } from '@/lib/vtu-idempotency-key-lookup';
import { overlayReplayAttributes } from '@/lib/vtu-replay-attribute-overlay';
import { verifyReplayTransactionBinding } from '@/lib/vtu-replay-binding';
import type { VtuWalletOnlyChargeInput } from '@/schemas/vtu-wallet-only';

type ReplayAuthUser = NonNullable<
  Awaited<ReturnType<typeof authenticateApiRequest>>['user']
>;

/**
 * Shared replay tail (Muse R128 extraction): binding → owner
 * presence → current-attempt overlay → fulfill. Moved verbatim from
 * the wallet-only route's two replay sites (main replay + PK-race
 * winner replay), which ran identical sequences — the owner-presence
 * check is the only addition. Guards (customer, merchant,
 * fingerprint) stay at the call sites: they compare against
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
  // Owner presence (Muse R128 medium, Codex R129 P1): legacy/manual
  // key rows can reference an unlinked guest customer, a vanished
  // row, or a row since claimed by someone else. The replay path is
  // READ-ONLY for customers (approved exception: linking happens
  // only on the fresh path inside prepare), so an unbound owner
  // must not debit a row never linked to the caller. Lookup ERRORS
  // throw (500, key kept): a 400 would rotate the key and risk a
  // second debit under a fresh key for an already-debited
  // transaction — and the same holds for an unbound owner (Codex
  // R152 P1): the old transaction may already be debited or still
  // processing, so a fresh-key rotation followed by a fresh prepare
  // (which links the same customer) can debit a second transaction.
  // Hence 425, not 400: both clients' rotation predicates carve out
  // 425 as no-rotation (ambiguous/infrastructure), so the key is
  // kept and the retry dedupes instead of re-debiting. The message
  // must never instruct a fresh key.
  const { data: ownerRow, error: ownerError } = await supabase
    .from('customers')
    .select('id, user_id')
    .eq('id', keyRow.customer_id)
    .maybeSingle();
  if (ownerError) {
    throw new Error(`Failed to resolve replay owner: ${ownerError.message}`);
  }
  if (!ownerRow || ownerRow.user_id !== user.id) {
    return NextResponse.json(
      {
        error:
          'Idempotency-Key owner cannot be verified yet. Please retry this same purchase instead of starting a new one.',
      },
      { status: 425 }
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
