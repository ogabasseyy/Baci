import type { GPTTotal } from '@/lib/agentic/checkout';
import {
  buildAlreadyPaidFinalizationResponse,
  readFinalizationOrderId,
  recoverFinalizationOrderWriteFailure,
  verifyBoundFinalizationOrder,
  writeFinalizedOrderSession,
} from '@/lib/agentic/checkout-bound-order-recovery';
import {
  buildAgenticCheckoutOrderPayload,
  readAgenticSharedCartBinding,
} from '@/lib/agentic/checkout-completion-payloads';
import { buildPaymentPendingCheckoutResponse } from '@/lib/agentic/checkout-completion-response';
import { releaseFinalizationClaimSafely } from '@/lib/agentic/checkout-finalization-compensation';
import {
  createAgenticCheckoutOrder,
  sendAgenticOrderCreatedWebhook,
} from '@/lib/agentic/checkout-order-dispatch';
import {
  buildOrderFinalizationClaim,
  claimAgenticOrderFinalization,
  recordAgenticOrderFinalizationOrderCreated,
} from '@/lib/agentic/checkout-order-finalization-claim';
import { isValidOrderFinalizationClaim } from '@/lib/agentic/checkout-order-finalization-claim-reference';
import { buildStoredAgenticIdempotencyResponse } from '@/lib/agentic/idempotency-response-storage';
import { revalidateAgenticOrderProductCaches } from '@/lib/agentic/revalidate-agentic-order-product-caches';
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
    const orderPayload = {
      ...buildAgenticCheckoutOrderPayload({
        buyer,
        dvaAccount,
        session: orderSession,
        sessionCalc: orderSessionCalc,
      }),
      ...(sharedCartBinding ? { shared_cart: sharedCartBinding } : {}),
    };
    let orderResult: Awaited<ReturnType<typeof createAgenticCheckoutOrder>>;
    try {
      orderResult = await createAgenticCheckoutOrder(orderPayload, supabase, {
        boundPrincipalId: sharedCartPrincipalId ?? null,
      });
    } catch (error) {
      await releaseFinalizationClaimSafely({
        finalizationClaim,
        merchantId,
        metadata,
        orderError: error,
        sessionId,
        supabase,
      });
      logger.error({
        error: sanitizeForLog(error),
        message: 'Order creation threw',
        sessionId: sanitizeForLog(sessionId),
      });
      return respond({ error: 'Order creation failed' }, 500);
    }
    if (!orderResult.ok) {
      await releaseFinalizationClaimSafely({
        finalizationClaim,
        merchantId,
        metadata,
        orderError: orderResult.error ?? orderResult.statusText,
        sessionId,
        supabase,
      });
      logger.error({
        error: sanitizeForLog(orderResult.error ?? orderResult.statusText),
        message: 'Order creation failed',
        sessionId: sanitizeForLog(sessionId),
        status: orderResult.status,
        statusText: orderResult.statusText,
      });
      // Binding conflicts (stale/expired/forbidden) are actionable: the
      // agent refreshes the cart and retries. Everything else stays masked.
      if (orderResult.status === 409 || orderResult.status === 403) {
        return respond(
          { error: orderResult.error || 'Shared cart binding conflict' },
          orderResult.status as 409 | 403
        );
      }
      return respond({ error: 'Order creation failed' }, 500);
    }
    const createdOrderId = orderResult.orderId;
    if (!createdOrderId) {
      await releaseFinalizationClaimSafely({
        finalizationClaim,
        merchantId,
        metadata,
        orderError: 'Missing order id',
        sessionId,
        supabase,
      });
      logger.error({
        message: 'Order creation response omitted order id',
        sessionId: sanitizeForLog(sessionId),
      });
      return respond({ error: 'Order creation failed' }, 500);
    }
    orderId = createdOrderId;
    await revalidateAgenticOrderProductCaches({
      merchantId,
      productIds: orderSessionCalc.lineItems.map(
        (lineItem) => lineItem.item.product_id
      ),
      sessionId,
      slugLookupFailureMessage:
        'Failed to load product slugs for PDP cache revalidation',
      outerFailureMessage:
        'Failed to revalidate product caches after agentic order creation',
      supabase,
    });
    const marker = await recordAgenticOrderFinalizationOrderCreated({
      finalizationClaim,
      merchantId,
      metadata,
      orderId,
      sessionId,
      supabase,
    });
    if (!marker.recorded) {
      logger.error({
        error: sanitizeForLog(
          marker.error ?? 'Order finalization marker failed'
        ),
        message: 'Agentic order finalization marker failed',
        orderId: sanitizeForLog(orderId),
        sessionId: sanitizeForLog(sessionId),
      });
      await recoverFinalizationOrderWriteFailure({
        sharedCartBound: !!sharedCartBinding,
        finalizationClaim,
        merchantId,
        metadata,
        orderError: marker.error ?? 'Order finalization marker failed',
        orderId,
        sessionId,
        supabase,
      });
      return respond({ error: 'Database error' }, 500);
    }
  }

  let orderAlreadyPaid = false;
  if (sharedCartBinding) {
    const verified = await verifyBoundFinalizationOrder({
      finalizationClaim,
      merchantId,
      metadata,
      orderId,
      sessionId,
      supabase,
    });
    if (!verified.ok)
      return respond({ error: verified.error }, verified.status);
    orderAlreadyPaid = verified.paid;
  }
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
