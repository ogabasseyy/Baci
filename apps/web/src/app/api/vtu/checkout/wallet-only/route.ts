import type { SupabaseClient } from '@supabase/supabase-js';
import { type NextRequest, NextResponse } from 'next/server';
import { authenticateApiRequest } from '@/lib/api-auth';
import { checkCsrfProtection } from '@/lib/csrf';
import { createAdminClient } from '@/lib/supabase/admin';
import { isUserFacingCheckoutError } from '@/lib/vtu-checkout-error-classifier';
import { fulfillPendingVtuTransaction } from '@/lib/vtu-fulfillment';
import { mapFulfillmentToResponse } from '@/lib/vtu-fulfillment-response';
import {
  preparePendingVtuTransaction,
  resolveVtuCustomer,
} from '@/lib/vtu-pending-transaction';
import { computeVtuWalletRequestFingerprint } from '@/lib/vtu-wallet-fingerprint';
import { parseWalletOnlyCheckoutRequest } from '@/lib/vtu-wallet-only-request';
import { withMerchantSlugAliasFallback } from '@/lib/with-merchant-slug-alias-fallback';

function createErrorResponse(error: string, status = 400) {
  return NextResponse.json({ error }, { status });
}

interface ExistingIdempotencyRow {
  key: string;
  vtu_transaction_id: string;
  customer_id: string;
  merchant_id: string;
  request_fingerprint: string;
}

/**
 * Merchant + customers row owned by the authed user under the slug.
 * Null customer = legitimate cross-customer signal (requester
 * doesn't own the recorded row). The merchant id backs the replay
 * storefront check: the fingerprint omits merchant binding, so
 * cross-storefront key reuse is rejected structurally. Uses shared
 * `resolveVtuCustomer` (same as prepare, incl. the email-fallback
 * backfill) so email-linked customers pass first replay.
 */
async function resolveRequestingOwnership(
  supabase: SupabaseClient,
  user: NonNullable<Awaited<ReturnType<typeof authenticateApiRequest>>['user']>,
  merchantSlug: string
): Promise<{ customerId: string | null; merchantId: string | null }> {
  // Alias-aware: the slug arrives in the POST body, which the proxy can't rewrite,
  // so a stale tab on a just-renamed store resolves via the alias table.
  const { data: merchant, error: merchantError } =
    await withMerchantSlugAliasFallback(merchantSlug, (s) =>
      supabase.from('merchants').select('id').eq('slug', s).maybeSingle()
    );
  if (merchantError || !merchant) {
    return { customerId: null, merchantId: null };
  }
  const customer = await resolveVtuCustomer({
    supabase,
    merchantId: merchant.id as string,
    user,
  });
  return {
    customerId: customer?.id ?? null,
    merchantId: merchant.id as string,
  };
}

async function findExistingIdempotencyRow(
  supabase: SupabaseClient,
  key: string
): Promise<ExistingIdempotencyRow | null> {
  const { data, error } = await supabase
    .from('vtu_idempotency_keys')
    .select(
      'key, vtu_transaction_id, customer_id, merchant_id, request_fingerprint'
    )
    .eq('key', key)
    .maybeSingle();
  if (error) {
    throw new Error(`Failed to look up idempotency key: ${error.message}`);
  }
  return data ?? null;
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
    if (auth.error || !auth.user) {
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
    // operation: a sign-in between the client's capture and this POST
    // swaps the ambient cookie, so a mismatched session must fail
    // closed instead of debiting the new account for the old payload.
    // 403 (not 409): nothing was recorded, so clients must KEEP the
    // key — 409 would rotate it and a retry-after-switch-back would
    // mint fresh and debit twice. Fingerprint-collision 409s stay.
    if (input.expectedUserId && input.expectedUserId !== auth.user.id) {
      return createErrorResponse(
        'Account changed during checkout. Please try again.',
        403
      );
    }

    const requestFingerprint = computeVtuWalletRequestFingerprint(input);

    const supabase = createAdminClient();
    const existing = await findExistingIdempotencyRow(supabase, idempotencyKey);

    // Replay path: reuse the existing vtu_transaction_id. Three guards
    // before we trust the mapping:
    //   1. Ownership (cross-customer/storefront collision → 400). A
    //      stolen key must not replay against another customer's row
    //      or another storefront's row (the fingerprint omits
    //      merchant binding, so the merchant id is asserted here).
    //   2. Payload fingerprint (changed-intent collision → 409). The
    //      mobile client correctly keeps the key on TimeoutError /
    //      NetworkError / 5xx, but the user could edit the form
    //      between attempts. Replaying the original vend on a
    //      changed payload would charge the wrong recipient/amount.
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
      const replayedFulfillment = await fulfillPendingVtuTransaction({
        supabase,
        transactionId: existing.vtu_transaction_id,
      });
      return mapFulfillmentToResponse(replayedFulfillment);
    }

    const prepared = await preparePendingVtuTransaction({
      supabase,
      user: auth.user,
      input: input,
      source: 'checkout',
      requireCustomer: true,
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
      // Likely a parallel submit won the race on the PRIMARY KEY. Two
      // cleanup steps:
      //   1. Delete the orphan vtu_transactions row we just created. It
      //      points at a customer + amount but is unreferenced from the
      //      idempotency table (the parallel call's row points at the
      //      OTHER vtu_transaction_id). Without this delete, a later
      //      reconciliation script that scans status='pending' could
      //      re-fulfill the orphan and produce a SECOND wallet debit
      //      under a fresh source_id (which the redeem RPC's per-id
      //      idempotency would NOT block).
      //   2. Re-fetch the winning idempotency row and proceed through
      //      the replay path.
      const { error: deleteError } = await supabase
        .from('vtu_transactions')
        .delete()
        .eq('id', prepared.transaction.id)
        .eq('status', 'pending')
        .eq('merchant_id', prepared.merchant.id);
      if (deleteError) {
        console.error('Failed to clean up orphan VTU row after key race:', {
          error: deleteError.message,
          transactionId: prepared.transaction.id,
        });
      }
      const racedExisting = await findExistingIdempotencyRow(
        supabase,
        idempotencyKey
      );
      if (racedExisting) {
        // Same guards as the regular replay path: customer + merchant
        // ownership (no privilege-escalation via PK race, no
        // cross-storefront replay) AND fingerprint (no changed-intent
        // silently fulfilling the winner's payload).
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
        const replayedFulfillment = await fulfillPendingVtuTransaction({
          supabase,
          transactionId: racedExisting.vtu_transaction_id,
        });
        return mapFulfillmentToResponse(replayedFulfillment);
      }
      // Log internally; don't leak the raw DB error to the client.
      console.error('Failed to record idempotency key:', {
        error: insertError.message,
        idempotencyKey,
      });
      return createErrorResponse('Failed to record idempotency key.', 500);
    }

    const fulfillment = await fulfillPendingVtuTransaction({
      supabase,
      transactionId: prepared.transaction.id,
    });
    return mapFulfillmentToResponse(fulfillment);
  } catch (error) {
    // Don't echo raw error messages to the client — `findExistingIdempotencyRow`
    // and other helpers wrap PostgREST errors that can leak Supabase URL /
    // schema fragments. Whitelist the user-facing errors thrown by
    // `preparePendingVtuTransaction`; everything else is a generic 500.
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
