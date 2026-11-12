import 'server-only';
import { NextResponse } from 'next/server';
import type { ImeiAccessClient } from '@/lib/imei-access';
import {
  cacheLookupResponse,
  cacheSuccessfulLookup,
} from '../route-cache-helpers';
import { errorBody, type ImeiLookupRow, json } from '../route-helpers';

type ClaimAnswer =
  | {
      status: 'claimed' | 'reclaimed';
      purpose: 'imei_check' | 'vtu';
      purchaseRef: string;
      amountKobo: number;
    }
  | {
      status:
        | 'not_found'
        | 'not_confirmed'
        | 'busy'
        | 'fulfilled'
        | 'refund_owed'
        | 'refunded';
    };

// Only the fields of a prepared Sickw provider this step uses.
interface PreparedProvider {
  binding: { provider: string };
  provider: { submit: (input: never) => Promise<unknown> };
  serviceTier: { checksIncluded?: unknown; name?: unknown };
}

export interface DeliverPaidImeiLookupDeps {
  claim: (operationId: string) => Promise<ClaimAnswer>;
  finish: (
    operationId: string,
    outcome: 'fulfilled' | 'failed'
  ) => Promise<string>;
  refund: (paymentId: string) => Promise<string>;
  prepare: (
    lookup: ImeiLookupRow
  ) => Promise<PreparedProvider | { response: Response }>;
}

const pending = (status: string) =>
  NextResponse.json(
    { status },
    { status: 202, headers: { 'Cache-Control': 'no-store' } }
  );

function cached(lookup: ImeiLookupRow) {
  if (lookup.cached_response && lookup.cached_status)
    return json(lookup.cached_response, lookup.cached_status);
  return pending('delivering');
}

/**
 * Fails the delivery: the payment's refund is opened FIRST (the IMEI money
 * guard only accepts a refunded status once a PiggyVest refund is owed), the
 * refund is sent (best effort; the drain retries), then the lookup is cached.
 */
async function failAndRefund(
  input: {
    lookup: ImeiLookupRow;
    operationId: string;
    supabaseAdmin: ImeiAccessClient;
  },
  deps: DeliverPaidImeiLookupDeps,
  outcome: {
    body: Record<string, unknown>;
    status: number;
    notFound: boolean;
    sickwStatus?: string;
  }
) {
  await deps.finish(input.operationId, 'failed');
  await deps.refund(input.operationId).catch(() => 'pending');
  const body = {
    ...outcome.body,
    refund: 'piggyvest_wallet',
    status: 'error' as const,
  };
  await cacheLookupResponse({
    body: body as never,
    lookupId: input.lookup.id,
    sickwStatus: outcome.sickwStatus,
    status: outcome.status,
    supabaseAdmin: input.supabaseAdmin,
    terminalStatus: outcome.notFound ? 'refunded_not_found' : 'refunded_error',
  });
  return json(body as never, outcome.status);
}

/**
 * IMEI check paid from the PiggyVest wallet, final step: run the lookup once
 * the payment is CONFIRMED, exactly once (the database delivery claim), and
 * refund exactly once if the lookup fails definitively. The caller has read
 * the lookup and checked the re-sent IMEI against its stored hash.
 */
export async function deliverPaidImeiLookup(
  input: {
    lookup: ImeiLookupRow;
    operationId: string;
    normalizedImei: string;
    supabaseAdmin: ImeiAccessClient;
  },
  deps: DeliverPaidImeiLookupDeps
): Promise<Response> {
  const { lookup, operationId } = input;
  // A previous request saved the outcome but did not record the delivery.
  if (lookup.status === 'completed') {
    await deps.finish(operationId, 'fulfilled').catch(() => 'conflict');
    return cached(lookup);
  }
  if (
    lookup.status === 'refunded_error' ||
    lookup.status === 'refunded_not_found'
  )
    return cached(lookup);
  if (lookup.status !== 'pending') return cached(lookup);

  const claim = await deps.claim(operationId);
  if (claim.status === 'not_confirmed' || claim.status === 'not_found')
    return pending('payment_pending');
  if (claim.status === 'busy') return pending('delivering');
  if (claim.status !== 'claimed' && claim.status !== 'reclaimed')
    return cached(lookup);
  if (claim.purpose !== 'imei_check' || claim.purchaseRef !== lookup.id)
    throw new Error('Wallet payment does not belong to this IMEI lookup');

  const prepared = await deps.prepare(lookup);
  if ('response' in prepared || prepared.binding.provider !== 'sickw')
    return await failAndRefund(input, deps, {
      body: errorBody({
        code: 'IMEI_TIER_NOT_AVAILABLE',
        error: 'This check is not available right now.',
      }) as never,
      status: 502,
      notFound: false,
    });
  const providerStartedAt = Date.now();
  const outcome = (await prepared.provider.submit({
    binding: prepared.binding,
    checksIncluded: prepared.serviceTier.checksIncluded,
    feedbackUrl: '',
    identifier: input.normalizedImei,
    referenceId: lookup.id,
    tierName: prepared.serviceTier.name,
  } as never)) as {
    kind: string;
    body: Record<string, unknown>;
    rawResponseText?: string;
    providerStatus?: string;
    status: number;
    refundReason?: string;
  };
  if (outcome.kind === 'complete') {
    const response = await cacheSuccessfulLookup({
      amount: Number(lookup.amount_ngn),
      customerId: lookup.customer_id,
      latencyMs: Date.now() - providerStartedAt,
      lookupId: lookup.id,
      merchantId: lookup.merchant_id,
      providerResult: {
        body: outcome.body as never,
        ok: true,
        rawResponseText: outcome.rawResponseText ?? '',
        sickwStatus: outcome.providerStatus,
        status: outcome.status,
      } as never,
      supabaseAdmin: input.supabaseAdmin,
      tier: lookup.tier,
    });
    // Recorded after the result is saved: the money guard accepts a completed
    // status only while the delivery is claimed.
    await deps.finish(operationId, 'fulfilled').catch(() => 'conflict');
    return response;
  }
  if (outcome.kind !== 'failure')
    throw new Error('Sickw unexpectedly returned a non-terminal outcome');
  return await failAndRefund(input, deps, {
    body: outcome.body,
    status: outcome.status,
    notFound: outcome.refundReason === 'not_found',
    sickwStatus: outcome.providerStatus,
  });
}
