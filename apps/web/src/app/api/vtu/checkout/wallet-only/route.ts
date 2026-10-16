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
 * scope — it needs SECURITY DEFINER RPCs). Tenant isolation is
 * pinned by application checks + route.test.ts (session binding,
 * fingerprint, PK-race cross-customer refusal, cross-merchant
 * rejection).
 */
function createErrorResponse(error: string, status = 400) {
  return NextResponse.json({ error }, { status });
}

/**
 * Wallet-only VTU checkout (no gateway; `walletAmount === amount`
 * enforced — partial coverage unsupported, gateways stubbed). Flow:
 * validate Idempotency-Key → replay existing mapping (wallet RPC
 * idempotency second backstop) → fresh key: prepare, record,
 * fulfill (wallet debit Phase B.5, then vend). Service-role client
 * only; no `transactions` row or Paystack hop.
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
    if (input.expectedUserId !== auth.user.id) {
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

    // Insert the idempotency-key row before fulfillment so a parallel
    // retry can SELECT it. The PRIMARY KEY on `key` makes this insert
    // the serialization point for concurrent submits with the same key.
    const { error: insertError } = await supabase
      .from('vtu_idempotency_keys')
      .insert({
        key: idempotencyKey,
        vtu_transaction_id: prepared.transaction.id,
        customer_id: prepared.customer.id,
        merchant_id: prepared.merchant.id,
        request_fingerprint: requestFingerprint,
      });
    if (insertError) {
      // Likely a parallel submit won the PRIMARY KEY race — but
      // re-read the mapping BEFORE treating our row as an orphan
      // (Codex R124 P2): an insert whose response was lost commits
      // anyway, so the "loser" may be the mapped winner. Cleaning
      // up our own row would delete it (spurious terminal 400) or,
      // when the delete fails and the failed-mark lands, strand the
      // key on a failed row whose no_collection_evidence marker
      // misses the refund dispatcher's no_charge shortcut — every
      // replay throws the split-without-debit invariant as a 500
      // while both clients retain on 5xx (stuck key). A missing
      // mapping means our insert truly failed (a committed winner
      // is always visible to this re-read), so the prepared row is
      // a genuine orphan. Two steps:
      //   1. Re-fetch the winner's row.
      //   2. Unless the winner is us, remove our orphan row
      //      (verified delete with a terminal failed-mark
      //      fallback): unreferenced from the idempotency table, it
      //      must not survive pending — a pending-scan reconciler
      //      could otherwise re-fulfill it into a SECOND debit (the
      //      redeem RPC's per-id idempotency would NOT block a
      //      fresh source). Then replay the winner.
      // The cleanup outcome never masks the replay (Muse R55 HIGH).
      const racedExisting = await findExistingIdempotencyRow(
        supabase,
        idempotencyKey
      );
      if (racedExisting?.vtu_transaction_id !== prepared.transaction.id) {
        const cleanupOutcome = await cleanupOrphanVtuTransactionAfterKeyRace({
          merchantId: prepared.merchant.id,
          supabase,
          transactionId: prepared.transaction.id,
        });
        if (cleanupOutcome === 'unresolved') {
          console.error(
            'Orphan VTU cleanup unresolved after idempotency-key race; row may strand pending:',
            { transactionId: prepared.transaction.id }
          );
        }
      }
      if (racedExisting) {
        // Same ownership + fingerprint guards as the replay path (no
        // privilege-escalation via PK race, no changed-intent replay).
        if (
          !prepared.customer?.id ||
          racedExisting.customer_id !== prepared.customer.id
        ) {
          return createErrorResponse(
            'Idempotency-Key does not belong to this customer.',
            400
          );
        }
        if (racedExisting.merchant_id !== prepared.merchant.id) {
          return createErrorResponse(
            'Idempotency-Key does not belong to this storefront.',
            400
          );
        }
        if (racedExisting.request_fingerprint !== requestFingerprint) {
          return createErrorResponse(
            'Idempotency-Key already used with a different request payload. Generate a fresh key for the new purchase.',
            409
          );
        }
        // Shared replay tail (guards above compare against the
        // prepared row instead of the requesting ownership).
        return fulfillReplayVtuTransaction({
          authSupabase: auth.supabase,
          input,
          keyRow: racedExisting,
          supabase,
          user: auth.user,
        });
      }
      // Log internally; don't leak the raw DB error to the client.
      // The key itself is the unguessable replay credential — log
      // the prepared transaction id instead (Muse R108 MEDIUM).
      console.error('Failed to record idempotency key:', {
        error: insertError.message,
        transactionId: prepared.transaction.id,
      });
      return createErrorResponse('Failed to record idempotency key.', 500);
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
