import type { GPTTotal } from '@/lib/agentic/checkout';
import {
  buildAlreadyPaidFinalizationResponse,
  readFinalizationOrderId,
  readFinalizationOrderState,
  recoverFinalizationOrderWriteFailure,
  verifyBoundFinalizationOrder,
  writeCancelledFinalizationSession,
  writeFinalizedOrderSession,
  writePaidFinalizationSession,
} from '@/lib/agentic/checkout-bound-order-recovery';
import { createFinalizationOrder } from '@/lib/agentic/checkout-completion-order-creation';
import {
  buildAgenticCheckoutOrderPayload,
  readAgenticSharedCartBinding,
} from '@/lib/agentic/checkout-completion-payloads';
import { buildPaymentPendingCheckoutResponse } from '@/lib/agentic/checkout-completion-response';
import { sendAgenticOrderCreatedWebhook } from '@/lib/agentic/checkout-order-dispatch';
import {
  buildOrderFinalizationClaim,
  claimAgenticOrderFinalization,
} from '@/lib/agentic/checkout-order-finalization-claim';
import { isValidOrderFinalizationClaim } from '@/lib/agentic/checkout-order-finalization-claim-reference';
import { buildStoredAgenticIdempotencyResponse } from '@/lib/agentic/idempotency-response-storage';
import { logger } from '@/lib/logger';
import { sanitizeForLog } from '@/lib/sanitize-core';
import type { FinalizeAgenticCheckoutInput } from './checkout-completion-finalize.types';

export async function finalizeAgenticCheckoutPayment({
  agentId,
  buyer,
  dvaAccount,
  expectedSessionUpdatedAt,
  finalizationClaimOverride,
  idempotencyKey,
  merchantId,
  metadata,
  orderSession,
  orderSessionCalc,
  requestId,
  route,
  sessionId,
  sharedCartPrincipalId,
  supabase,
}: FinalizeAgenticCheckoutInput) {
  const respond = (response: unknown, status: number) =>
    buildStoredAgenticIdempotencyResponse({
      agentId,
      idempotencyKey,
      merchantId,
      requestId,
      response,
      route,
      status,
      supabase,
    });
  if (
    finalizationClaimOverride !== undefined &&
    !isValidOrderFinalizationClaim(finalizationClaimOverride)
  ) {
    logger.warn({
      message: 'Rejected invalid agentic finalization claim override',
      sessionId: sanitizeForLog(sessionId),
    });
    return respond({ error: 'Invalid finalization claim' }, 400);
  }
  if (finalizationClaimOverride !== undefined && !expectedSessionUpdatedAt) {
    return respond({ error: 'Missing finalization timestamp' }, 400);
  }
  const finalizationClaim =
    finalizationClaimOverride ??
    buildOrderFinalizationClaim({
      idempotencyKey,
      requestId,
      sessionId,
    });
  const claim = await claimAgenticOrderFinalization({
    buyer,
    dvaAccount,
    expectedUpdatedAt: expectedSessionUpdatedAt,
    finalizationClaim,
    merchantId,
    metadata,
    sessionId,
    supabase,
  });
  if (claim.error) {
    logger.error({
      error: sanitizeForLog(claim.error),
      message: 'Agentic checkout order finalization claim write failed',
      sessionId: sanitizeForLog(sessionId),
    });
    return respond({ error: 'Database error' }, 500);
  }
  if (!claim.claimed) {
    logger.warn({
      message: 'Agentic checkout order finalization claim failed',
      sessionId: sanitizeForLog(sessionId),
    });
    return respond(
      {
        error: 'Session finalization already in progress',
        status: 'payment_pending',
      },
      409
    );
  }
  const sharedCartBinding = readAgenticSharedCartBinding(metadata);
  let orderId = readFinalizationOrderId(metadata);
  if (!orderId) {
    const creation = await createFinalizationOrder({
      finalizationClaim,
      merchantId,
      metadata,
      orderPayload: {
        ...buildAgenticCheckoutOrderPayload({
          buyer,
          dvaAccount,
          session: orderSession,
          sessionCalc: orderSessionCalc,
        }),
        ...(sharedCartBinding ? { shared_cart: sharedCartBinding } : {}),
      },
      productIds: orderSessionCalc.lineItems.map(
        (lineItem) => lineItem.item.product_id
      ),
      sessionId,
      sharedCartBound: !!sharedCartBinding,
      sharedCartPrincipalId,
      supabase,
    });
    if (!creation.ok) {
      return respond({ error: creation.error }, creation.status);
    }
    orderId = creation.orderId;
  }

  // Live order-state verification is not binding-specific: an
  // unbound retry reusing a recorded order id must not resurrect a
  // paid or cancelled order as payment_pending either.
  let orderAlreadyPaid = false;
  const verified = await verifyBoundFinalizationOrder({
    finalizationClaim,
    merchantId,
    metadata,
    orderId,
    sessionId,
    supabase,
  });
  if (!verified.ok) return respond({ error: verified.error }, verified.status);
  orderAlreadyPaid = verified.paid;
  const { data: updatedSession, error: updateError } =
    await writeFinalizedOrderSession({
      buyer,
      dvaAccount,
      metadata,
      orderId,
      orderAlreadyPaid,
      supabase,
      sessionId,
      merchantId,
      finalizationClaim,
    });

  if (updateError || !updatedSession) {
    logger.error({
      error: sanitizeForLog(updateError ?? 'No checkout session row updated'),
      message: 'Agentic checkout session payment state update failed',
      orderId: sanitizeForLog(orderId),
      sessionId: sanitizeForLog(sessionId),
    });
    await recoverFinalizationOrderWriteFailure({
      sharedCartBound: !!sharedCartBinding,
      finalizationClaim,
      merchantId,
      metadata,
      orderError: updateError ?? 'No checkout session row updated',
      orderId,
      sessionId,
      supabase,
    });
    return respond({ error: 'Database error' }, 500);
  }

  // Revalidate after the session write: a payment or cancellation
  // landing between verification and the write must not receive
  // payment instructions or a duplicate order-created webhook.
  if (!orderAlreadyPaid) {
    const recheck = await readFinalizationOrderState({
      merchantId,
      orderId,
      supabase,
    });
    if (recheck === 'paid') {
      const paidWrite = await writePaidFinalizationSession({
        buyer,
        dvaAccount,
        merchantId,
        metadata,
        orderId,
        sessionId,
        supabase,
      });
      if (paidWrite.error || !paidWrite.data) {
        // Do not claim a paid response the session row does not
        // hold: a zero-row conditional update (a concurrent
        // finalizer moved the session) leaves it payment_pending,
        // and a later request could otherwise serve transfer
        // instructions for an already-paid order.
        return respond({ error: 'Payment session update failed' }, 500);
      }
      orderAlreadyPaid = true;
    } else if (recheck === 'conflict') {
      const reconciled = await writeCancelledFinalizationSession({
        merchantId,
        metadata,
        orderId,
        sessionId,
        supabase,
      });
      if (reconciled.error || !reconciled.data) {
        // The 409 must not be stored while the session can still
        // serve transfer instructions for the cancelled order; a
        // zero-row update means it never left payment_pending.
        return respond({ error: 'Payment session update failed' }, 500);
      }
      return respond({ error: 'Order is no longer awaiting payment' }, 409);
    } else if (recheck === 'error') {
      // The revalidation itself failed: fence the session out of
      // payment_pending before returning, because the failed read
      // may have hidden a paid or cancelled order and a later
      // request would otherwise serve the stored instructions
      // without revalidating. The fence result is verified just
      // like the paid branch: a failed fence write must not return
      // 503 while the session can still serve the instructions.
      const fenced = await writeCancelledFinalizationSession({
        merchantId,
        metadata,
        orderId,
        sessionId,
        supabase,
      });
      if (fenced.error || !fenced.data) {
        return respond({ error: 'Payment session update failed' }, 500);
      }
      return respond({ error: 'temporarily_unavailable' }, 503);
    }
  }
  if (orderAlreadyPaid) {
    return respond(
      buildAlreadyPaidFinalizationResponse(sessionId, orderId),
      200
    );
  }
  sendAgenticOrderCreatedWebhook({
    buyer,
    currency: orderSession.currency,
    orderId,
    sessionId,
    total:
      orderSessionCalc.totals.find((t: GPTTotal) => t.type === 'total')
        ?.amount ?? 0,
  });

  const responsePayload = buildPaymentPendingCheckoutResponse({
    buyer,
    dvaAccount,
    orderId,
    session: orderSession,
    sessionCalc: orderSessionCalc,
  });
  return respond(responsePayload, 200);
}
