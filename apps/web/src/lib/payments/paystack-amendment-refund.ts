import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { logger } from '@/lib/logger';
import { listPaystackRefunds } from '@/lib/orders/list-paystack-refunds';
import { paystackRequest } from '@/lib/paystack-request';
import { selectPaystackRefundReference } from '@/lib/select-paystack-refund-reference';
import {
  amendmentRefundAttemptIdsSchema,
  paystackAmendmentProviderIdSchema,
  paystackAmendmentRefundClaimSchema,
  paystackAmendmentRefundEvidenceSchema,
} from '@/schemas/order-amendment-payment';
import { paystackAmendmentRefundReference } from '@/schemas/paystack-refund-event';

type Database = Pick<SupabaseClient, 'rpc'>;

function preserveProviderIds(raw: string) {
  return raw.replace(
    /"(id|transaction|integration)"\s*:\s*(\d+)(?=\s*[,}])/g,
    '"$1":"$2"'
  );
}

async function reconcileRefund(supabase: Database, reference: string) {
  const verified = await paystackRequest<unknown>(
    `/refund?reference=${encodeURIComponent(reference)}`,
    {
      signal: AbortSignal.timeout(8_000),
      preprocessResponseText: preserveProviderIds,
    }
  );
  if (
    !verified.success ||
    !Array.isArray(verified.data) ||
    verified.data.length !== 1
  ) {
    return 'retry';
  }
  const parsed = paystackAmendmentRefundEvidenceSchema.safeParse(
    verified.data[0]
  );
  if (
    !parsed.success ||
    parsed.data.reference.toLowerCase() !== reference.toLowerCase()
  ) {
    return 'retry';
  }
  const { transaction, ...evidence } = parsed.data;
  const { data, error } = await supabase.rpc(
    'record_paid_order_amendment_refund',
    {
      p_reference: reference,
      p_evidence: {
        ...evidence,
        reference,
        transactionId:
          typeof transaction === 'string' ? transaction : transaction.id,
      },
    }
  );
  return error ||
    ![
      'pending',
      'processing',
      'needs_attention',
      'failed',
      'processed',
    ].includes(data)
    ? 'retry'
    : 'recorded';
}

export async function routePaystackAmendmentRefund(
  supabase: Database,
  event: Record<string, unknown> | undefined
): Promise<'untracked' | 'retry' | 'recorded' | 'ignored'> {
  const reference = paystackAmendmentRefundReference.safeParse(
    event?.refund_reference ?? event?.reference
  );
  const transaction = event?.transaction;
  const captureReference = selectPaystackRefundReference(
    transaction !== null &&
      typeof transaction === 'object' &&
      'reference' in transaction
      ? transaction.reference
      : undefined,
    event?.transaction_reference
  );
  const id = event?.id;
  const providerId =
    typeof id === 'number' && Number.isSafeInteger(id) && id > 0
      ? String(id)
      : paystackAmendmentProviderIdSchema.safeParse(id).data;
  if (!reference.success && !providerId && !captureReference)
    return 'untracked';
  const { data, error } = await supabase.rpc(
    'find_paid_order_amendment_refund',
    {
      p_reference: reference.data ?? null,
      p_provider_id: providerId ?? null,
      p_capture_reference: captureReference ?? null,
    }
  );
  if (error) return 'retry';
  // Dispatch requires a committed attempt, so a missing explicit amendment
  // reference is not an early webhook. Keep it out of cancellation routing.
  if (data == null) return reference.success ? 'ignored' : 'untracked';
  const ownedReference = paystackAmendmentRefundReference.safeParse(data);
  return ownedReference.success
    ? reconcileRefund(supabase, ownedReference.data)
    : 'retry';
}

export async function drainPaystackAmendmentRefunds(
  supabase: Database,
  deadlineMs: number
) {
  const finance = await supabase.rpc(
    'retry_due_paid_order_amendment_adjustments',
    { p_limit: 2 }
  );
  if (finance.error)
    logger.error({ message: 'Unable to retry amendment adjustments' });
  const due = await supabase.rpc('list_due_paid_order_amendment_refunds', {
    p_limit: 5,
  });
  if (due.error) throw new Error('Unable to load due amendment refunds');
  const attempts = amendmentRefundAttemptIdsSchema.parse(due.data);
  for (const id of attempts) {
    if (Date.now() + 24_000 >= deadlineMs) return;
    try {
      await processRefundAttempt(supabase, id, deadlineMs);
    } catch {
      logger.error({
        message: 'Unable to process an amendment refund attempt',
      });
    }
  }
}

async function processRefundAttempt(
  supabase: Database,
  id: string,
  deadlineMs: number
) {
  const result = await supabase.rpc('claim_paid_order_amendment_refund', {
    p_attempt: id,
  });
  if (result.error) throw new Error('Unable to claim amendment refund');
  if (result.data == null) return;
  const claim = paystackAmendmentRefundClaimSchema.parse(result.data);
  const providerKey = process.env.PAYSTACK_SECRET_KEY ?? '';
  if (
    process.env.PAID_ORDER_AMENDMENT_PAYSTACK_INTEGRATION_ID !==
      claim.integrationId ||
    !providerKey.startsWith(claim.domain === 'live' ? 'sk_live_' : 'sk_test_')
  ) {
    // The preflight lease only delays the next lookup. It never marks a refund
    // as submitted or prevents recovery once the worker credentials match.
    logger.error({
      message: 'Amendment refund worker integration does not match the attempt',
      attemptId: id,
      domain: claim.domain,
      integrationId: claim.integrationId,
    });
    return;
  }

  if (claim.submit || claim.preflightReview) {
    // Keep undispatched work queued while provider preflight is unavailable.
    // Once authorized, an ambiguous response is looked up by reference.
    const prior = await listPaystackRefunds(claim.captureReference, {
      deadlineMs: deadlineMs - 16_000,
      expectedCapture: {
        id: claim.captureId,
        domain: claim.domain,
        integrationId: claim.integrationId,
      },
    });
    if (Date.now() + 16_000 >= deadlineMs) return;
    const openIds = prior
      .filter((refund) => refund.status !== 'failed')
      .map((refund) => refund.id);
    if (claim.preflightReview) {
      const resolution = await supabase.rpc(
        'resolve_paid_order_amendment_refund_preflight',
        {
          p_attempt: id,
          p_failed_ids: prior
            .filter((refund) => refund.status === 'failed')
            .map((refund) => refund.id),
          p_open_ids: openIds,
        }
      );
      if (resolution.error)
        throw new Error('Unable to resolve amendment refund review');
      return;
    }
    const dispatch = await supabase.rpc(
      'authorize_paid_order_amendment_refund_dispatch',
      {
        p_attempt: id,
        p_clear: openIds.length === 0,
        p_open_ids: openIds,
      }
    );
    if (dispatch.error) throw new Error('Unable to authorize amendment refund');
    if (dispatch.data !== true) return;
    const submitted = await paystackRequest('/refund', {
      method: 'POST',
      body: JSON.stringify({
        transaction: claim.captureReference,
        amount: claim.amountMinor,
        reference: claim.reference,
      }),
      signal: AbortSignal.timeout(8_000),
    });
    if (!submitted.success) {
      logger.warn({
        message: 'Amendment refund submission did not return acceptance',
        attemptId: id,
        code: submitted.code,
      });
    }
  }
  if ((await reconcileRefund(supabase, claim.reference)) === 'retry') {
    logger.warn({
      message: 'Amendment refund still requires provider reconciliation',
      attemptId: id,
    });
  }
}
