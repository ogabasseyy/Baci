import { VTU_CANONICAL_IDEMPOTENCY_KEY_HEADER } from '@baci/shared/lib';
import { type NextRequest, NextResponse } from 'next/server';
import { authenticateApiRequest } from '@/lib/api-auth';
import { checkCsrfProtection } from '@/lib/csrf';
import { createAdminClient } from '@/lib/supabase/admin';
import { isUserFacingCheckoutError } from '@/lib/vtu-checkout-error-classifier';
import { resolveRequestingOwnership } from '@/lib/vtu-checkout-ownership';
import { fulfillPendingVtuTransaction } from '@/lib/vtu-fulfillment';
import { mapFulfillmentToResponse } from '@/lib/vtu-fulfillment-response';
import { findExistingIdempotencyRow } from '@/lib/vtu-idempotency-key-lookup';
import { cleanupOrphanVtuTransactionAfterKeyRace } from '@/lib/vtu-orphan-transaction-cleanup';
import { preparePendingVtuTransaction } from '@/lib/vtu-pending-transaction';
import { fulfillReplayVtuTransaction } from '@/lib/vtu-replay-fulfillment';
import { computeVtuWalletRequestFingerprint } from '@/lib/vtu-wallet-fingerprint';
import { parseWalletOnlyCheckoutRequest } from '@/lib/vtu-wallet-only-request';

/**
 * SERVICE-ROLE BOUNDARY (owner-approved narrow exception, PR #3655,
 * expires 2027-01-14 or when the RLS+RPC migration epic lands — see
 * AGENTS.md TEMPORARY VTU WALLET-ONLY CHECKOUT EXCEPTION). This
 * user-facing route runs its reads/writes on the service-role client
 * because no safe partial move exists: the customer email-link flow
 * needs cross-user reads RLS would hide, and vtu_transactions /
 * vtu_idempotency_keys have no customer-facing policies (the replay
 * lookup is keyed by the unguessable key alone, which RLS cannot
 * scope — it needs SECURITY DEFINER RPCs). Exactly-once claiming
 * is enforced server-side by the service_role-only claim_vtu_intent
 * RPC (the authority; client registries are hints). Tenant
 * isolation is pinned by application checks + route.test.ts
 * (session binding, fingerprint, claim-race cross-customer
 * refusal, cross-merchant rejection, terminal exclusion).
 */
function createErrorResponse(error: string, status = 400) {
  return NextResponse.json({ error }, { status });
}

/**
 * Wallet-only VTU checkout (no gateway; `walletAmount === amount`
 * enforced — partial coverage unsupported, gateways stubbed). Flow:
 * validate Idempotency-Key → replay existing mapping (wallet RPC
 * idempotency second backstop) → fresh key: prepare, claim
 * (records-or-joins via claim_vtu_intent), fulfill (wallet debit
 * Phase B.5, then vend). Service-role client only; no
 * `transactions` row or Paystack hop.
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await authenticateApiRequest(request);
    if (auth.error || !auth.user || !auth.supabase) {
      return createErrorResponse(auth.error || 'Unauthorized', 401);
    }

    const { valid: csrfValid, response: csrfResponse } =
      await checkCsrfProtection(request);
    if (!csrfValid) {
      return csrfResponse ?? createErrorResponse('CSRF validation failed', 403);
    }

    const parsedRequest = await parseWalletOnlyCheckoutRequest(request);
    if (!parsedRequest.ok) {
      if (parsedRequest.details !== undefined) {
        return NextResponse.json(
          { error: parsedRequest.error, details: parsedRequest.details },
          { status: parsedRequest.status }
        );
      }
      return createErrorResponse(parsedRequest.error, parsedRequest.status);
    }
    const { idempotencyKey, input } = parsedRequest;

    // Bind the checkout to the submitting account before ANY database
    // operation: a sign-in between capture and POST swaps the ambient
    // cookie. 403 (not 409): nothing was recorded, so clients KEEP
    // the key — 409 would rotate it and debit twice after switch-back.
    // A missing pin (pre-binding clients) binds to the session user
    // instead of rejecting (Codex R137 P1): omitting the pin cannot
    // impersonate anyone (the binding target is server-derived), it
    // only forgoes switch detection — pre-pin behavior.
    if (
      input.expectedUserId !== undefined &&
      input.expectedUserId !== auth.user.id
    ) {
      return createErrorResponse(
        'Account changed during checkout. Please try again.',
        403
      );
    }

    const requestFingerprint = computeVtuWalletRequestFingerprint(input);

    const supabase = createAdminClient();
    const existing = await findExistingIdempotencyRow(supabase, idempotencyKey);

    // Replay path: reuse the existing vtu_transaction_id after the
    // ownership guard (a stolen key must not replay cross-customer/
    // storefront — the fingerprint omits merchant binding) and the
    // payload-fingerprint guard (changed intent → 409, else we would
    // charge the wrong recipient/amount).
    if (existing) {
      const requestingOwnership = await resolveRequestingOwnership(
        supabase,
        auth.user,
        input.merchantSlug
      );
      if (
        !requestingOwnership.customerId ||
        existing.customer_id !== requestingOwnership.customerId
      ) {
        return createErrorResponse(
          'Idempotency-Key does not belong to this customer.',
          400
        );
      }
      if (
        !requestingOwnership.merchantId ||
        existing.merchant_id !== requestingOwnership.merchantId
      ) {
        return createErrorResponse(
          'Idempotency-Key does not belong to this storefront.',
          400
        );
      }
      if (existing.request_fingerprint !== requestFingerprint) {
        return createErrorResponse(
          'Idempotency-Key already used with a different request payload. Generate a fresh key for the new purchase.',
          409
        );
      }
      // Shared replay tail: binding → owner claim → overlay →
      // fulfill (Muse R128 extraction; guards above compare against
      // the requesting ownership).
      return fulfillReplayVtuTransaction({
        authSupabase: auth.supabase,
        input,
        keyRow: existing,
        supabase,
        user: auth.user,
      });
    }

    const prepared = await preparePendingVtuTransaction({
      supabase,
      user: auth.user,
      input: input,
      source: 'checkout',
      requireCustomer: true,
      strictLookups: true,
    });

    if (!prepared.customer?.id) {
      return createErrorResponse(
        'Customer account not found for this storefront',
        404
      );
    }

    // Exactly-once intent claim (epic #3694): the RPC records our
    // (key, transaction) mapping for this intent scope, or joins the
    // scope's in-flight transaction when another key won the race
    // (second tab/device, registry loss, double submit). Terminal
    // transactions are never joined: a new key after terminalization
    // starts a new purchase (repeat purchases share fingerprints).
    // The RPC returns the authoritative mapping, subsuming the old
    // insert + PK-race re-read (Codex R124 P2).
    const { data: claimRows, error: claimError } = await supabase.rpc(
      'claim_vtu_intent',
      {
        p_key: idempotencyKey,
        p_fingerprint: requestFingerprint,
        p_transaction_id: prepared.transaction.id,
        p_merchant_id: prepared.merchant.id,
        p_customer_id: prepared.customer.id,
      }
    );
    if (claimError) {
      // Same-key race lost on a changed payload: the key is mapped
      // with another fingerprint — same 409 contract as the replay
      // path. Scope mismatch (key-UUID collision; the route's
      // ownership checks already reject cross-tenant keys) → 400.
      if (claimError.message.startsWith('claim_fingerprint_mismatch')) {
        return createErrorResponse(
          'Idempotency-Key already used with a different request payload. Generate a fresh key for the new purchase.',
          409
        );
      }
      if (claimError.message.startsWith('claim_scope_mismatch')) {
        return createErrorResponse(
          'Idempotency-Key does not belong to this customer.',
          400
        );
      }
      // Log internally; don't leak the raw DB error to the client.
      // The key itself is the unguessable replay credential — log
      // the prepared transaction id instead (Muse R108 MEDIUM).
      console.error('Failed to claim VTU purchase intent:', {
        error: claimError.message,
        transactionId: prepared.transaction.id,
      });
      return createErrorResponse('Failed to claim VTU purchase intent.', 500);
    }
    const claim = claimRows?.[0];
    if (!claim) {
      console.error('VTU intent claim returned no mapping:', {
        transactionId: prepared.transaction.id,
      });
      return createErrorResponse('Failed to claim VTU purchase intent.', 500);
    }

    if (claim.transaction_id !== prepared.transaction.id) {
      // Loser path: another key owns this intent's in-flight
      // transaction. Discard our prepared row via the existing
      // orphan cleanup (guarded pending→failed + no-collection
      // marker; no reversal — prepare doesn't debit), then replay
      // the winner. Same-scope/same-fingerprint by RPC
      // construction, so no ownership re-check is needed. The
      // cleanup outcome never masks the replay (Muse R55 HIGH).
      const cleanupOutcome = await cleanupOrphanVtuTransactionAfterKeyRace({
        merchantId: prepared.merchant.id,
        supabase,
        transactionId: prepared.transaction.id,
      });
      if (cleanupOutcome === 'unresolved') {
        console.error(
          'Orphan VTU cleanup unresolved after intent-claim join; row may strand pending:',
          { transactionId: prepared.transaction.id }
        );
      }
      // Joins should be rare (registries normally reuse keys); a
      // join storm signals client key churn — investigate the
      // registry, not the claim.
      console.info('VTU intent claim joined in-flight transaction:', {
        preparedTransactionId: prepared.transaction.id,
        winnerTransactionId: claim.transaction_id,
        winnerKey: claim.idempotency_key,
      });
      const replayResponse = await fulfillReplayVtuTransaction({
        authSupabase: auth.supabase,
        input,
        keyRow: {
          key: claim.idempotency_key,
          vtu_transaction_id: claim.transaction_id,
          customer_id: prepared.customer.id,
          merchant_id: prepared.merchant.id,
          request_fingerprint: requestFingerprint,
        },
        supabase,
        user: auth.user,
      });
      // Winner-key wire: the loser's key has no mapping, so the
      // clients adopt the winner key for subsequent retries instead
      // of re-preparing + orphaning on every attempt. Same-scope by
      // RPC construction — nothing cross-principal is disclosed.
      replayResponse.headers.set(
        VTU_CANONICAL_IDEMPOTENCY_KEY_HEADER,
        claim.idempotency_key
      );
      return replayResponse;
    }

    const fulfillment = await fulfillPendingVtuTransaction({
      supabase,
      transactionId: prepared.transaction.id,
    });
    return mapFulfillmentToResponse(fulfillment);
  } catch (error) {
    // Don't echo raw errors (PostgREST fragments can leak Supabase URL /
    // schema). Whitelisted prepare/overlay errors → 400; else → 500.
    const message = error instanceof Error ? error.message : '';
    if (isUserFacingCheckoutError(message)) {
      return createErrorResponse(message, 400);
    }

    console.error('Wallet-only checkout failed:', {
      error: error instanceof Error ? error.message : String(error),
    });
    return createErrorResponse('Wallet-only checkout failed.', 500);
  }
}
