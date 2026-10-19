import { recoverFinalizationOrderWriteFailure } from '@/lib/agentic/checkout-bound-order-recovery';
import { releaseFinalizationClaimSafely as releaseClaim } from '@/lib/agentic/checkout-finalization-compensation';
import { createAgenticCheckoutOrder } from '@/lib/agentic/checkout-order-dispatch';
import { recordAgenticOrderFinalizationOrderCreated } from '@/lib/agentic/checkout-order-finalization-claim';
import { revalidateAgenticOrderProductCaches } from '@/lib/agentic/revalidate-agentic-order-product-caches';
import { logger } from '@/lib/logger';
import { sanitizeForLog } from '@/lib/sanitize-core';
import type { FinalizeAgenticCheckoutInput } from './checkout-completion-finalize.types';

type CreationInput = Pick<
  FinalizeAgenticCheckoutInput,
  'merchantId' | 'metadata' | 'sessionId' | 'supabase'
> & {
  finalizationClaim: string;
  orderPayload: Parameters<typeof createAgenticCheckoutOrder>[0];
  productIds: string[];
  sharedCartBound: boolean;
  sharedCartPrincipalId?: string | null;
};

export type FinalizationOrderCreation =
  | { ok: true; orderId: string }
  | { ok: false; error: string; status: number };

/**
 * Creates the order for a claimed finalization and records the
 * creation marker. Every failure releases (or compensates) the claim
 * and returns the response the finalize flow should store, so a
 * failed creation never leaves the session claimed or paid-claimed.
 */
export async function createFinalizationOrder(
  input: CreationInput
): Promise<FinalizationOrderCreation> {
  const { finalizationClaim, merchantId, metadata, sessionId, supabase } =
    input;
  let orderResult: Awaited<ReturnType<typeof createAgenticCheckoutOrder>>;
  try {
    orderResult = await createAgenticCheckoutOrder(
      input.orderPayload,
      supabase,
      { boundPrincipalId: input.sharedCartPrincipalId ?? null }
    );
  } catch (error) {
    await releaseClaim({
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
    return { error: 'Order creation failed', ok: false, status: 500 };
  }
  if (!orderResult.ok) {
    await releaseClaim({
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
      return {
        error: orderResult.error || 'Shared cart binding conflict',
        ok: false,
        status: orderResult.status,
      };
    }
    return { error: 'Order creation failed', ok: false, status: 500 };
  }
  const orderId = orderResult.orderId;
  if (!orderId) {
    await releaseClaim({
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
    return { error: 'Order creation failed', ok: false, status: 500 };
  }
  await revalidateAgenticOrderProductCaches({
    merchantId,
    productIds: input.productIds,
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
      error: sanitizeForLog(marker.error ?? 'Order finalization marker failed'),
      message: 'Agentic order finalization marker failed',
      orderId: sanitizeForLog(orderId),
      sessionId: sanitizeForLog(sessionId),
    });
    await recoverFinalizationOrderWriteFailure({
      sharedCartBound: input.sharedCartBound,
      finalizationClaim,
      merchantId,
      metadata,
      orderError: marker.error ?? 'Order finalization marker failed',
      orderId,
      sessionId,
      supabase,
    });
    return { error: 'Database error', ok: false, status: 500 };
  }
  return { ok: true, orderId };
}
