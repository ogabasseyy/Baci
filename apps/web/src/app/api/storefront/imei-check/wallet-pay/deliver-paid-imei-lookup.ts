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
      claimToken: string;
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
  // Only the current claimant (its token) may finish delivery.
  finish: (
    operationId: string,
    outcome: 'fulfilled' | 'failed',
    claimToken: string
  ) => Promise<string>;
  refund: (paymentId: string) => Promise<string>;
  prepare: (
    lookup: ImeiLookupRow
  ) => Promise<PreparedProvider | { response: Response }>;
  // The lookup's stored status, re-read to prove a result was persisted.
  readStatus: (lookupId: string) => Promise<string | null>;
}

type Input = {
  lookup: ImeiLookupRow;
  operationId: string;
  normalizedImei: string;
  supabaseAdmin: ImeiAccessClient;
};
type Outcome = {
  body: Record<string, unknown>;
  status: number;
  notFound: boolean;
  sickwStatus?: string;
};

const NOT_COMPLETED: Outcome = {
  body: errorBody({
    code: 'LOOKUP_NOT_COMPLETED',
    error:
      'The check could not be completed. Your payment is being returned to your PiggyVest wallet.',
  }) as never,
  status: 502,
  notFound: false,
};

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

/** Caches the refunded outcome of a lookup whose PiggyVest refund is owed. */
async function cacheRefunded(input: Input, outcome: Outcome) {
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
 * Fails the delivery: the payment's refund is opened FIRST (the IMEI money
 * guard only accepts a refunded status once a PiggyVest refund is owed), the
 * refund is sent (best effort; the drain retries), then the lookup is cached.
 * Recording the failure is retried once; if it still fails the claim stays
 * and a later reclaim refunds. A failed cache is retried by the next request,
 * which finds the refund owed.
 */
async function failAndRefund(
  input: Input,
  deps: DeliverPaidImeiLookupDeps,
  claimToken: string,
  outcome: Outcome
) {
  await deps
    .finish(input.operationId, 'failed', claimToken)
    .catch(() => deps.finish(input.operationId, 'failed', claimToken));
  await deps.refund(input.operationId).catch(() => 'pending');
  return await cacheRefunded(input, outcome);
}

type SickwOutcome = {
  kind: string;
  body: Record<string, unknown>;
  rawResponseText?: string;
  providerStatus?: string;
  status: number;
  refundReason?: string;
};

/**
 * IMEI check paid from the PiggyVest wallet, final step: run the lookup once
 * the payment is CONFIRMED, exactly once (the database delivery claim), and
 * refund exactly once if the lookup fails definitively. The caller has read
 * the lookup and checked the re-sent IMEI against its stored hash.
 */
export async function deliverPaidImeiLookup(
  input: Input,
  deps: DeliverPaidImeiLookupDeps
): Promise<Response> {
  const { lookup, operationId } = input;
  // A previous request saved the outcome but did not record the delivery:
  // take the claim (its token) and record it, never a second lookup.
  if (lookup.status === 'completed') {
    const late = await deps.claim(operationId).catch(() => null);
    if (late && (late.status === 'claimed' || late.status === 'reclaimed'))
      await deps
        .finish(operationId, 'fulfilled', late.claimToken)
        .catch(() => 'conflict');
    return cached(lookup);
  }
  if (lookup.status !== 'pending') return cached(lookup);

  const claim = await deps.claim(operationId);
  if (claim.status === 'not_confirmed' || claim.status === 'not_found')
    return pending('payment_pending');
  if (claim.status === 'busy' || claim.status === 'fulfilled')
    return pending('delivering');
  // The refund is owed or sent, but caching the refunded outcome failed
  // earlier: persist it now.
  if (claim.status === 'refund_owed' || claim.status === 'refunded')
    return await cacheRefunded(input, NOT_COMPLETED);
  if (claim.status !== 'claimed' && claim.status !== 'reclaimed')
    return cached(lookup);
  if (claim.purpose !== 'imei_check' || claim.purchaseRef !== lookup.id)
    throw new Error('Wallet payment does not belong to this IMEI lookup');
  // A previous delivery died mid-flight. Sickw has no lookup by reference,
  // so re-submitting could buy the check twice: refund instead.
  if (claim.status === 'reclaimed')
    return await failAndRefund(input, deps, claim.claimToken, NOT_COMPLETED);

  const prepared = await deps.prepare(lookup);
  if ('response' in prepared || prepared.binding.provider !== 'sickw')
    return await failAndRefund(input, deps, claim.claimToken, {
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
  } as never)) as SickwOutcome;
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
    // Recorded only once the result is durably saved (the helper answers 200
    // even when saving failed). Unsaved, the claim stays and a later reclaim
    // refunds, so a paid result is never left unrecoverable.
    const saved = await deps.readStatus(lookup.id).catch(() => null);
    if (saved === 'completed')
      await deps
        .finish(operationId, 'fulfilled', claim.claimToken)
        .catch(() => 'conflict');
    return response;
  }
  // Anything but a definite failure (an unexpected non-terminal answer)
  // delivered no result: refund rather than leave the claim stranded.
  if (outcome.kind !== 'failure')
    return await failAndRefund(input, deps, claim.claimToken, NOT_COMPLETED);
  return await failAndRefund(input, deps, claim.claimToken, {
    body: outcome.body,
    status: outcome.status,
    notFound: outcome.refundReason === 'not_found',
    sickwStatus: outcome.providerStatus,
  });
}
