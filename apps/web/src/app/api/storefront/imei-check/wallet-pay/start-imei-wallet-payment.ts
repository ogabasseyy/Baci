import 'server-only';
import type { ImeiDeviceCategory, ImeiServiceTierKey } from '@baci/shared/imei';
import type { SupabaseClient, User } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import type { ImeiAccessClient } from '@/lib/imei-access';
import { resolvePrimaryWalletIdentity } from '@/lib/piggyvest/primary-wallet-identity';
import { readWalletPayRuntime } from '@/lib/piggyvest/wallet-pay-runtime';
import { walletPayScope } from '@/lib/piggyvest/wallet-pay-scope';
import {
  findWalletPaymentForPurchase,
  issueWalletPayment,
} from '@/lib/piggyvest/wallet-pay-service';
import {
  errorBody,
  findLookupByIdempotencyKey,
  isUniqueViolation,
  mapExistingLookup,
} from '../route-helpers';

type Issue = typeof issueWalletPayment;
export interface StartImeiWalletPaymentDeps {
  readRuntime: typeof readWalletPayRuntime;
  resolveIdentity: (input: {
    supabase: SupabaseClient;
    user: User;
    merchantId: string;
  }) => Promise<{
    merchantId: string;
    customerId: string;
    userId: string;
  } | null>;
  issue: Issue;
  findForPurchase: typeof findWalletPaymentForPurchase;
}

const defaultDeps: StartImeiWalletPaymentDeps = {
  readRuntime: readWalletPayRuntime,
  resolveIdentity: (input) =>
    resolvePrimaryWalletIdentity({ ...input, forOnboarding: false }),
  issue: issueWalletPayment,
  findForPurchase: findWalletPaymentForPurchase,
};

function refuse(code: string, error: string, status: number) {
  return NextResponse.json(errorBody({ code, error }), { status });
}

/**
 * IMEI check paid from the PiggyVest main wallet, step 1: create the pending
 * lookup and issue a payment of exactly the server price. Nothing is charged
 * here; the customer confirms with their PIN on the wallet-pay route. Only
 * Sickw (instant) tiers are offered: Petrock's debit lives in deeper database
 * functions that do not know PiggyVest yet.
 */
export async function startImeiWalletPayment(
  input: {
    binding: { provider: string };
    serviceTier: { price: number };
    customer: { id: string };
    merchantId: string;
    idempotencyKey: string;
    imeiHash: string;
    deviceCategory?: ImeiDeviceCategory;
    requestedTier: ImeiServiceTierKey;
    replayContext: Parameters<typeof mapExistingLookup>[1];
    supabase: SupabaseClient;
    supabaseAdmin: ImeiAccessClient;
    user: User;
  },
  deps: StartImeiWalletPaymentDeps = defaultDeps
) {
  let runtime: ReturnType<typeof readWalletPayRuntime>;
  try {
    runtime = deps.readRuntime();
  } catch {
    // Switched on but misconfigured: retryable, like the PIN and pay routes.
    return refuse(
      'PIGGYVEST_PAY_UNAVAILABLE',
      'Paying from your PiggyVest wallet is not available right now.',
      503
    );
  }
  if (!runtime || runtime.merchantId !== input.merchantId)
    return refuse(
      'PIGGYVEST_PAY_UNAVAILABLE',
      'Paying from your PiggyVest wallet is not available yet.',
      409
    );
  if (input.binding.provider !== 'sickw')
    return refuse(
      'PIGGYVEST_PAY_UNAVAILABLE_FOR_TIER',
      'This check can not be paid from your PiggyVest wallet yet.',
      409
    );
  const identity = await deps.resolveIdentity({
    supabase: input.supabase,
    user: input.user,
    merchantId: input.merchantId,
  });
  if (!identity || identity.customerId !== input.customer.id)
    return refuse(
      'PIGGYVEST_WALLET_NOT_READY',
      'Finish setting up your PiggyVest wallet to pay from it.',
      409
    );

  let amount = input.serviceTier.price;
  let lookupId: string;
  let created = false;
  const inserted = await input.supabaseAdmin.insertPending({
    amount_ngn: amount,
    customer_id: input.customer.id,
    idempotency_key: input.idempotencyKey,
    imei_hash: input.imeiHash,
    device_category: input.deviceCategory ?? null,
    merchant_id: input.merchantId,
    status: 'pending',
    tier: input.requestedTier,
  });
  if (inserted.error) {
    if (!isUniqueViolation(inserted.error))
      throw new Error('IMEI pending insert failed');
    const existing = await findLookupByIdempotencyKey(
      input.supabaseAdmin,
      input.idempotencyKey
    );
    // A replay of this same request re-asks for the same payment; anything
    // else answers exactly as the store-credit path does.
    if (!existing)
      return refuse('IDEMPOTENCY_CONFLICT', 'Please try again.', 409);
    if (
      existing.status !== 'pending' ||
      existing.customer_id !== input.customer.id ||
      existing.imei_hash !== input.imeiHash ||
      existing.tier !== input.requestedTier ||
      (existing.device_category ?? null) !== (input.deviceCategory ?? null)
    )
      return mapExistingLookup(existing, input.replayContext);
    // Only a lookup this wallet flow owns (a PiggyVest payment was issued for
    // it) is re-asked: a concurrent store-credit request that won the insert
    // must never also be paid from the wallet.
    const owned = await deps.findForPurchase({
      runtime,
      scope: walletPayScope(runtime, identity),
      purpose: 'imei_check',
      purchaseRef: String(existing.id),
    });
    // Only a payment still open (not yet settled) is re-asked: a confirmed or
    // refunded one must never be followed by a second payment for the check.
    if (!owned || !['issued', 'reserved', 'dispatched'].includes(owned.state))
      return mapExistingLookup(existing, input.replayContext);
    lookupId = String(existing.id);
    // The price recorded on the lookup, never today's tier price.
    amount = Number(existing.amount_ngn);
  } else {
    if (!inserted.data) throw new Error('IMEI pending insert returned no row');
    lookupId = String(inserted.data.id);
    created = true;
  }

  const issued = await deps.issue({
    runtime,
    scope: walletPayScope(runtime, identity),
    request: {
      purpose: 'imei_check',
      purchaseRef: lookupId,
      amountKobo: Math.round(amount * 100),
    },
  });
  if (issued.status === 'unavailable') {
    // No payment exists for the lookup this request just created: remove it
    // (best effort; the database refuses once a payment exists) so a retry
    // with the same key can issue instead of answering a conflict forever.
    if (created)
      await (async () => input.supabaseAdmin.deletePending(lookupId))().catch(
        () => null
      );
    return refuse(
      'PIGGYVEST_PAY_UNAVAILABLE',
      'Paying from your PiggyVest wallet is not available right now.',
      503
    );
  }
  if (issued.status === 'conflict' || !('operationId' in issued))
    return refuse('PAYMENT_CONFLICT', 'Please refresh and try again.', 409);
  if (issued.status === 'issued')
    return NextResponse.json(
      {
        status: 'payment_required',
        lookupId,
        operationId: issued.operationId,
        amountKobo: issued.amountKobo,
        expiresAt: issued.expiresAt,
      },
      { status: 202, headers: { 'Cache-Control': 'no-store' } }
    );
  return NextResponse.json(
    {
      status:
        issued.status === 'needs_review' ? 'payment_review' : 'payment_pending',
      lookupId,
      operationId: issued.operationId,
      amountKobo: issued.amountKobo,
    },
    { status: 202, headers: { 'Cache-Control': 'no-store' } }
  );
}
