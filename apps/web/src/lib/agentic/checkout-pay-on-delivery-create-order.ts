import type { SupabaseClient } from '@supabase/supabase-js';
import type { calculateCheckoutSession } from '@/lib/agentic/checkout';
import { readAgenticSharedCartBinding } from '@/lib/agentic/checkout-completion-payloads';
import type { AgenticCheckoutBuyer } from '@/lib/agentic/checkout-completion-response';
import { createAgenticCheckoutOrder } from '@/lib/agentic/checkout-order-dispatch';
import { releasePayOnDeliveryClaimSafely } from '@/lib/agentic/checkout-pay-on-delivery-compensation';
import { buildPayOnDeliveryOrderPayload } from '@/lib/agentic/checkout-pay-on-delivery-payloads';
import type { AgenticMetadata } from '@/lib/agentic/checkout-storage';
import { revalidateAgenticOrderProductCaches } from '@/lib/agentic/revalidate-agentic-order-product-caches';
import { logger } from '@/lib/logger';
import { sanitizeForLog } from '@/lib/sanitize-core';

type CheckoutCalculation = Awaited<ReturnType<typeof calculateCheckoutSession>>;

/**
 * Creates the pay-on-delivery order under the finalization claim.
 * Every failure releases the claim safely before returning, so the
 * caller only maps the outcome to its stored response.
 */
export async function createPayOnDeliveryOrder(input: {
  buyer: AgenticCheckoutBuyer;
  finalizationClaim: string;
  finalizationMetadata: AgenticMetadata;
  merchantId: string;
  orderSession: {
    currency: string;
    merchant_id: string;
    session_id: string;
    shipping_address?: unknown;
  };
  orderSessionCalc: CheckoutCalculation;
  sessionId: string;
  sharedCartPrincipalId?: string | null;
  supabase: SupabaseClient;
}): Promise<{ ok: true; orderId: string } | { ok: false }> {
  const {
    buyer,
    finalizationClaim,
    finalizationMetadata,
    merchantId,
    orderSession,
    orderSessionCalc,
    sessionId,
    sharedCartPrincipalId,
    supabase,
  } = input;
  // Mirror the DVA completion path: a session with a prepared
  // shared-cart binding submits bound, so the reviewed generation is
  // revalidated and closed atomically with order creation. Unbound
  // pay-on-delivery would otherwise charge stale session items and
  // leave the prepared cart active for a second order.
  const sharedCartBinding = readAgenticSharedCartBinding(finalizationMetadata);
  const orderPayload = {
    ...buildPayOnDeliveryOrderPayload({
      buyer,
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
    await releasePayOnDeliveryClaimSafely({
      finalizationClaim,
      merchantId,
      metadata: finalizationMetadata,
      orderError: error,
      sessionId,
      supabase,
    });
    logger.error({
      error: sanitizeForLog(error),
      message: 'Pay-on-delivery order creation threw',
      sessionId: sanitizeForLog(sessionId),
    });
    return { ok: false };
  }

  if (!orderResult.ok) {
    await releasePayOnDeliveryClaimSafely({
      finalizationClaim,
      merchantId,
      metadata: finalizationMetadata,
      orderError: orderResult.error ?? orderResult.statusText,
      sessionId,
      supabase,
    });
    logger.error({
      error: sanitizeForLog(orderResult.error ?? orderResult.statusText),
      message: 'Pay-on-delivery order creation failed',
      sessionId: sanitizeForLog(sessionId),
    });
    return { ok: false };
  }

  const createdOrderId = orderResult.orderId;
  if (!createdOrderId) {
    await releasePayOnDeliveryClaimSafely({
      finalizationClaim,
      merchantId,
      metadata: finalizationMetadata,
      orderError: 'Missing order id',
      sessionId,
      supabase,
    });
    logger.error({
      message: 'Pay-on-delivery order creation response omitted order id',
      sessionId: sanitizeForLog(sessionId),
    });
    return { ok: false };
  }
  await revalidateAgenticOrderProductCaches({
    merchantId,
    productIds: orderSessionCalc.lineItems.map(
      (lineItem) => lineItem.item.product_id
    ),
    sessionId,
    slugLookupFailureMessage:
      'Failed to look up product slugs for PDP cache revalidation after agentic pay-on-delivery order creation',
    outerFailureMessage:
      'Failed to revalidate product caches after agentic pay-on-delivery order creation',
    supabase,
  });
  return { ok: true, orderId: createdOrderId };
}
