import { VTU_CANONICAL_IDEMPOTENCY_KEY_HEADER } from '@baci/shared/lib';
import { type NextRequest, NextResponse } from 'next/server';
import { authenticateApiRequest } from '@/lib/api-auth';
import { checkCsrfProtection } from '@/lib/csrf';
import { createAdminClient } from '@/lib/supabase/admin';
import { isUserFacingCheckoutError } from '@/lib/vtu-checkout-error-classifier';
import { resolveRequestingOwnership } from '@/lib/vtu-checkout-ownership';
import {
  admitVtuClaim,
  VtuAdmissionError,
  type VtuAdmissionProof,
} from '@/lib/vtu-claim-admission';
import { discardOrphanedClaimTransaction } from '@/lib/vtu-claim-orphan-discard';
import { respondToClaimError } from '@/lib/vtu-claim-rejection';
import { fulfillPendingVtuTransaction } from '@/lib/vtu-fulfillment';
import { mapFulfillmentToResponse } from '@/lib/vtu-fulfillment-response';
import type { ExistingIdempotencyRow } from '@/lib/vtu-idempotency-key-lookup';
import { preparePendingVtuTransaction } from '@/lib/vtu-pending-transaction';
import { fulfillReplayVtuTransaction } from '@/lib/vtu-replay-fulfillment';
import { computeVtuWalletRequestFingerprint } from '@/lib/vtu-wallet-fingerprint';
import { parseWalletOnlyCheckoutRequest } from '@/lib/vtu-wallet-only-request';

/**
 * SERVICE-ROLE BOUNDARY (owner-approved narrow exception, PR #3655,
 * narrowed Phase 2, epic #3694; expires 2027-01-14 or when the
 * migration epic lands — see AGENTS.md TEMPORARY VTU WALLET-ONLY
 * CHECKOUT EXCEPTION). Reads/writes run on the authenticated
 * client: buyer RLS policies for owned-row reads, JWT-verifying
 * SECURITY DEFINER RPCs for the key lookup, customer find/link,
 * settings projection, prepare insert, intent claim, and orphan
 * cleanup. The service-role client exists ONLY for the
 * admission-proof RPC (merchant-wide live set spans customers by
 * design — fence input only, never returned) and
 * fulfillPendingVtuTransaction (wallet debit/credit/refund RPCs
 * plus its transaction, ledger, marker, loyalty, and notification
 * writes — criterion 3's documented privilege boundary). Tenant
 * isolation is pinned by RLS + the RPC ownership checks +
 * route.test.ts + supabase/tests/vtu_checkout_*.sql.
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
 * Phase B.5, then vend). Authenticated client except fulfillment;
 * no `transactions` row or Paystack hop.
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

    // Authenticated client for everything except the admission
    // proof and fulfillment (Phase 2): RLS + JWT-verifying RPCs
    // own tenant isolation here.
    const userSupabase = auth.supabase;
    const adminSupabase = createAdminClient();
    // Admission (Codex R3 P1, R4 P1): key lookup + atomic DB
    // admission proof (stamp + live-scope snapshot) for the claim
    // overlap fence. No proof → fail closed BEFORE preparing
    // (nothing to orphan; the client retries the same key).
    let existing: ExistingIdempotencyRow | null;
    let foreign: boolean;
    let proof: VtuAdmissionProof | null;
    try {
      ({ existing, foreign, proof } = await admitVtuClaim(
        userSupabase,
        adminSupabase,
        idempotencyKey,
        auth.user.id,
        input.merchantSlug,
        requestFingerprint
      ));
    } catch (error) {
      if (!(error instanceof VtuAdmissionError)) throw error;
      console.error('VTU admission proof unavailable:', error.message);
      return createErrorResponse('Failed to admit VTU claim.', 500);
    }
    // A key mapped to another customer: same 400 the ownership
    // guard returned (the verdict reveals existence, which that
    // 400 already did — no row fields cross over).
    if (foreign) {
      return createErrorResponse(
        'Idempotency-Key does not belong to this customer.',
        400
      );
    }

    // Replay path: reuse the existing vtu_transaction_id after the
    // ownership guard (a stolen key must not replay cross-customer/
    // storefront — the fingerprint omits merchant binding) and the
    // payload-fingerprint guard (changed intent → 409, else we would
    // charge the wrong recipient/amount).
    if (existing) {
      const requestingOwnership = await resolveRequestingOwnership(
        userSupabase,
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
      // the requesting ownership). Service role reaches only the
      // fulfill inside (narrowed exception).
      return fulfillReplayVtuTransaction({
        authSupabase: auth.supabase,
        input,
        keyRow: existing,
        supabase: createAdminClient(),
        user: auth.user,
      });
    }

    const prepared = await preparePendingVtuTransaction({
      supabase: userSupabase,
      user: auth.user,
      input: input,
      source: 'checkout',
      requireCustomer: true,
      strictLookups: true,
      linkCustomerViaRpc: true,
      insertViaRpc: true,
    });

    if (!prepared.customer?.id) {
      return createErrorResponse(
        'Customer account not found for this storefront',
        404
      );
    }

    // Exactly-once intent claim (epic #3694): the RPC records our
    // (key, transaction) mapping for this intent scope, or joins the
    // scope's live-or-overlapping transaction when another key won
    // the race (second tab/device, registry loss, double submit).
    // Terminals that settled before our admission are never joined:
    // a new key after terminalization starts a new purchase
    // (repeat purchases share fingerprints); terminals overlapping
    // our admission join (same in-flight operation, even when
    // preparation delays our row past terminalization — Codex R3
    // P1 — or the writer's xact-start stamp predates our admission
    // while its commit lands inside our window, proven by the
    // admission-liveness snapshot — Codex R4 P1). The RPC returns
    // the authoritative mapping, subsuming the old insert +
    // PK-race re-read (Codex R124 P2).
    // Fresh keys always carry proof (admit throws otherwise).
    if (!proof) return createErrorResponse('Failed to admit VTU claim.', 500);
    const { data: claimRows, error: claimError } = await userSupabase.rpc(
      'claim_vtu_intent',
      {
        p_key: idempotencyKey,
        p_fingerprint: requestFingerprint,
        p_transaction_id: prepared.transaction.id,
        p_merchant_id: prepared.merchant.id,
        p_customer_id: prepared.customer.id,
        p_admitted_at: proof.admittedAt,
        p_admission_live: proof.admissionLive,
      }
    );
    if (claimError) {
      // Certain-abort claim rejections (claim_*): the RPC raised,
      // so NOTHING was recorded — our prepared row is orphaned and
      // must be discarded before responding (Codex R1 P2).
      // Transport/unknown errors skip cleanup: the claim may still
      // have committed, and deleting a referenced row would
      // CASCADE-kill the mapping (see the transport-failure test).
      if (claimError.message.startsWith('claim_')) {
        await discardOrphanedClaimTransaction({
          context: 'rejection',
          merchantId: prepared.merchant.id,
          supabase: userSupabase,
          transactionId: prepared.transaction.id,
          userId: auth.user.id,
        });
      }
      return respondToClaimError(claimError, prepared.transaction.id);
    }
    const claim = claimRows?.[0];
    if (!claim) {
      console.error('VTU intent claim returned no mapping:', {
        transactionId: prepared.transaction.id,
      });
      return createErrorResponse('Failed to claim VTU purchase intent.', 500);
    }

    if (claim.transaction_id !== prepared.transaction.id) {
      // Loser path: another key owns this intent's transaction.
      // Discard our prepared row (guarded pending→failed +
      // no-collection marker; no reversal — prepare doesn't
      // debit), then replay the winner. Same-scope/
      // same-fingerprint by RPC construction, so no ownership
      // re-check is needed.
      await discardOrphanedClaimTransaction({
        context: 'join',
        merchantId: prepared.merchant.id,
        supabase: userSupabase,
        transactionId: prepared.transaction.id,
        userId: auth.user.id,
      });
      // Joins should be rare (registries normally reuse keys); a
      // join storm signals client key churn — investigate the
      // registry, not the claim. Transaction IDs only: the winner
      // key is an unguessable replay credential and must never
      // reach logs (Codex R2 P2, Muse R108).
      console.info('VTU intent claim joined in-flight transaction:', {
        preparedTransactionId: prepared.transaction.id,
        winnerTransactionId: claim.transaction_id,
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
        supabase: createAdminClient(),
        user: auth.user,
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

    // Sole service-role use on this route (narrowed exception).
    const fulfillment = await fulfillPendingVtuTransaction({
      supabase: createAdminClient(),
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
