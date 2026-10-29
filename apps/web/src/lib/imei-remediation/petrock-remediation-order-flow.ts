import 'server-only';

import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { createPetrockClient } from '@/lib/imei-providers/petrock/petrock-client';
import { isDefinitivePetrockSubmissionRejection } from '@/lib/imei-providers/petrock/petrock-submission-outcome';
import {
  isRetryablePetrockStateWriteError,
  retryPetrockStateWrite,
} from '@/lib/imei-providers/petrock/retry-petrock-state-write';

import { isPetrockRemediationOrderEligible } from './petrock-remediation-order-eligibility';

type PetrockClient = ReturnType<typeof createPetrockClient>;

interface RemediationOrderState {
  begin(input: {
    feedbackTokenHash: string;
    orderId: string;
    referenceId: string;
  }): Promise<boolean>;
  finalize(input: {
    customerMessage: string;
    failureReason?: string;
    orderId: string;
    providerStatus: string;
    success: boolean;
  }): Promise<boolean>;
  failBeforeAcceptance(input: {
    customerMessage: string;
    orderId: string;
    reason: string;
  }): Promise<boolean>;
  markSubmissionUnknown(input: {
    orderId: string;
    providerOrderId?: string;
    reason: string;
  }): Promise<boolean>;
  prepare(input: {
    orderId: string;
    paymentCurrency: 'NGN' | 'USDT';
    productId: string;
  }): Promise<unknown>;
  recordSubmission(input: {
    nextPollAt: string;
    orderId: string;
    providerOrderId: string;
    providerStatus: string;
  }): Promise<boolean>;
  redeem(input: { orderId: string }): Promise<unknown>;
  resetPreparedQuote(input: {
    orderId: string;
    reason: string;
  }): Promise<boolean>;
}

function quoteCoversProviderCost({
  fxRate,
  order,
  paymentCurrency,
  product,
}: {
  fxRate: number;
  order: {
    amountNgn: number | null;
    amountUsdt: number | null;
    status: 'eligible' | 'paid' | 'payment_pending';
  };
  paymentCurrency: 'NGN' | 'USDT';
  product: {
    catalogCostUsd: number;
    priceNgn: number;
    priceUsdt: number;
  };
}) {
  if (!Number.isFinite(fxRate) || fxRate <= 0) return false;
  const amount =
    paymentCurrency === 'NGN'
      ? order.status === 'eligible'
        ? product.priceNgn
        : order.amountNgn
      : order.status === 'eligible'
        ? product.priceUsdt
        : order.amountUsdt;
  const required =
    paymentCurrency === 'NGN'
      ? product.catalogCostUsd * fxRate
      : product.catalogCostUsd;
  return (
    amount !== null &&
    Number.isFinite(amount) &&
    amount > 0 &&
    amount + 0.01 >= required
  );
}

export async function placePetrockRemediationOrder({
  client,
  fxRate,
  identifier,
  order,
  origin,
  paymentCurrency,
  product,
  state,
}: {
  client: Pick<PetrockClient, 'getAccount' | 'submitOrder'>;
  fxRate: number;
  identifier: string;
  order: {
    amountNgn: number | null;
    amountUsdt: number | null;
    costUsd: number;
    customerId: string;
    id: string;
    merchantId: string;
    eligibilityEvidence: unknown;
    providerOrderId: string | null;
    providerAttemptStartedAt: string | null;
    status: 'eligible' | 'paid' | 'payment_pending';
  };
  origin: string;
  paymentCurrency: 'NGN' | 'USDT';
  product: {
    active: boolean;
    catalogCostUsd: number;
    catalogOrderFieldName: string;
    catalogSyncedAt: string;
    carrier: string;
    modelScope: unknown;
    statusSegment: string;
    curatedProductId: string;
    orderFieldName: string;
    priceNgn: number;
    priceUsdt: number;
    providerProductId: string;
  };
  state: RemediationOrderState;
}) {
  // A saved/claimed paid row may already have advanced in another request.
  if (order.providerOrderId || order.providerAttemptStartedAt)
    return { kind: 'already_started' as const };
  if (!isPetrockRemediationOrderEligible(order.eligibilityEvidence, product)) {
    if (order.status === 'paid') {
      const refunded = await state.failBeforeAcceptance({
        customerMessage:
          'This unlock is not eligible; your wallet was refunded.',
        orderId: order.id,
        reason: 'eligibility_evidence_invalid',
      });
      return {
        kind: refunded ? ('failed' as const) : ('already_started' as const),
      };
    }
    if (order.status === 'payment_pending') {
      const reset = await state.resetPreparedQuote({
        orderId: order.id,
        reason: 'eligibility_evidence_invalid',
      });
      if (!reset) return { kind: 'already_started' as const };
    }
    return { kind: 'eligibility_failed' as const };
  }
  const catalogAge = Date.now() - Date.parse(product.catalogSyncedAt);
  if (
    !product.active ||
    product.catalogOrderFieldName !== product.orderFieldName ||
    product.catalogCostUsd > order.costUsd * 1.25 ||
    product.catalogCostUsd < order.costUsd * 0.75 ||
    !Number.isFinite(catalogAge) ||
    catalogAge < 0 ||
    catalogAge > 48 * 60 * 60 * 1000 ||
    !quoteCoversProviderCost({ fxRate, order, paymentCurrency, product })
  ) {
    if (order.status === 'paid') {
      const refunded = await state.failBeforeAcceptance({
        customerMessage:
          'This unlock could not be submitted, so your wallet was refunded.',
        orderId: order.id,
        reason: 'provider_preflight_failed',
      });
      if (!refunded) return { kind: 'already_started' as const };
    } else if (order.status === 'payment_pending') {
      await state.resetPreparedQuote({
        orderId: order.id,
        reason: 'provider_preflight_failed',
      });
    }
    return { kind: 'preflight_failed' as const };
  }

  const account = await client.getAccount();
  if (
    !account.ok ||
    account.data.currency !== 'USD' ||
    account.data.balance < product.catalogCostUsd
  ) {
    if (order.status === 'paid') {
      const refunded = await state.failBeforeAcceptance({
        customerMessage:
          'This unlock could not be submitted, so your wallet was refunded.',
        orderId: order.id,
        reason: 'provider_preflight_failed',
      });
      if (!refunded) return { kind: 'already_started' as const };
    }
    return { kind: 'preflight_failed' as const };
  }

  if (order.status === 'eligible') {
    await state.prepare({
      orderId: order.id,
      paymentCurrency,
      productId: product.curatedProductId,
    });
  }
  if (order.status !== 'paid') {
    await state.redeem({ orderId: order.id });
  }

  const feedbackToken = randomBytes(32).toString('base64url');
  const referenceId = randomUUID();
  const began = await state.begin({
    feedbackTokenHash: createHash('sha256').update(feedbackToken).digest('hex'),
    orderId: order.id,
    referenceId,
  });
  if (!began) return { kind: 'already_started' as const };

  const submission = await client.submitOrder({
    feedbackUrl: `${origin}/api/webhooks/petrock/remediation/${feedbackToken}`,
    identifier,
    orderFieldName: product.orderFieldName,
    productId: product.providerProductId,
    referenceId,
  });
  if (!submission.ok) {
    if (!isDefinitivePetrockSubmissionRejection(submission)) {
      await state.markSubmissionUnknown({
        orderId: order.id,
        reason: `submit_${submission.kind}`,
      });
      return { kind: 'submission_unknown' as const };
    }
    const refunded = await state.failBeforeAcceptance({
      customerMessage: 'The carrier could not accept this unlock order.',
      orderId: order.id,
      reason: 'provider_submit_rejected',
    });
    return {
      kind: refunded ? ('failed' as const) : ('already_started' as const),
    };
  }

  try {
    const recorded = await retryPetrockStateWrite(
      () =>
        state.recordSubmission({
          nextPollAt: new Date(Date.now() + 30_000).toISOString(),
          orderId: order.id,
          providerOrderId: submission.data.orderUuid,
          providerStatus: 'new',
        }),
      isRetryablePetrockStateWriteError
    );
    if (!recorded) {
      throw new Error('Accepted remediation submission transition rejected');
    }
  } catch (error) {
    console.error('[Petrock Remediation] Accepted order state save failed', {
      error,
      orderId: order.id,
      providerOrderId: submission.data.orderUuid,
    });
    await state.markSubmissionUnknown({
      orderId: order.id,
      providerOrderId: submission.data.orderUuid,
      reason: 'accepted_submission_persistence_failed',
    });
    return { kind: 'submission_unknown' as const };
  }
  return { kind: 'pending' as const };
}
