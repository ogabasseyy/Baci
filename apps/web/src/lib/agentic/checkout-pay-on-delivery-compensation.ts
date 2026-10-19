import type { SupabaseClient } from '@supabase/supabase-js';
import { markAgenticCheckoutOrderCanceled } from '@/lib/agentic/checkout-order-dispatch';
import { releasePayOnDeliveryFinalizationClaim } from '@/lib/agentic/checkout-pay-on-delivery-claim';
import type { AgenticMetadata } from '@/lib/agentic/checkout-storage';
import { logger } from '@/lib/logger';
import { sanitizeForLog } from '@/lib/sanitize-core';

export async function releasePayOnDeliveryClaimSafely({
  finalizationClaim,
  merchantId,
  metadata,
  orderError,
  sessionId,
  supabase,
}: {
  finalizationClaim: string;
  merchantId: string;
  metadata: AgenticMetadata;
  orderError: unknown;
  sessionId: string;
  supabase: SupabaseClient;
}): Promise<boolean> {
  try {
    const release = await releasePayOnDeliveryFinalizationClaim({
      finalizationClaim,
      merchantId,
      metadata,
      orderError,
      sessionId,
      supabase,
    });
    return release.released === true;
  } catch (error) {
    logger.error({
      error: sanitizeForLog(error),
      message: 'Pay-on-delivery finalization claim release threw',
      sessionId: sanitizeForLog(sessionId),
    });
    return false;
  }
}

export async function compensatePayOnDeliveryFinalizationFailure({
  finalizationClaim,
  merchantId,
  metadata,
  orderError,
  orderId,
  sessionId,
  supabase,
  bound,
}: {
  finalizationClaim: string;
  merchantId: string;
  metadata: AgenticMetadata;
  orderError: unknown;
  orderId: string;
  sessionId: string;
  supabase: SupabaseClient;
  /**
   * A bound order creation atomically completed the cart and stored
   * the binding replay receipt: canceling the order would strand the
   * checkout (the completed cart can only replay that canceled
   * order), so bound failures only release the finalization claim.
   */
  bound?: boolean;
}) {
  if (bound) {
    const releaseSucceeded = await releasePayOnDeliveryClaimSafely({
      finalizationClaim,
      merchantId,
      metadata,
      orderError,
      sessionId,
      supabase,
    });
    logger.error({
      error: {
        orderError: sanitizeForLog(orderError),
        releaseSucceeded,
      },
      message:
        'Pay-on-delivery finalization failed after bound order creation; order preserved',
      orderId: sanitizeForLog(orderId),
      sessionId: sanitizeForLog(sessionId),
    });
    return;
  }
  let cancellationError: unknown = null;
  let cancellationUpdated = false;
  let releaseSucceeded: boolean | null = null;
  try {
    const cancellation = await markAgenticCheckoutOrderCanceled({
      merchantId,
      orderId,
      sessionId,
      supabase,
    });
    cancellationError = cancellation.error;
    cancellationUpdated = cancellation.updated;
  } catch (error) {
    cancellationError = error;
  }

  if (!cancellationError && cancellationUpdated) {
    releaseSucceeded = await releasePayOnDeliveryClaimSafely({
      finalizationClaim,
      merchantId,
      metadata,
      orderError,
      sessionId,
      supabase,
    });
  }

  logger.error({
    error: {
      cancellationError: cancellationError
        ? sanitizeForLog(cancellationError)
        : null,
      cancellationUpdated,
      orderError: sanitizeForLog(orderError),
      releaseSucceeded,
    },
    message: 'Pay-on-delivery finalization failed after order creation',
    orderId: sanitizeForLog(orderId),
    sessionId: sanitizeForLog(sessionId),
  });
}
