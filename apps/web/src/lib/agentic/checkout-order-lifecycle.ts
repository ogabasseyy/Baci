import type { SupabaseClient } from '@supabase/supabase-js';
import type { AgenticCheckoutBuyer } from '@/lib/agentic/checkout-completion-response';
import { sendAgenticWebhook } from '@/lib/agentic/webhooks';
import { logger } from '@/lib/logger';
import { sanitizeForLog } from '@/lib/sanitize-core';

/**
 * Post-creation order lifecycle helpers for agentic checkout: the
 * order.created webhook fan-out and the compensating cancellation of
 * a still-pending order. Split from the order dispatcher so its
 * module stays within the repository file-size boundary.
 */
export function sendAgenticOrderCreatedWebhook({
  buyer,
  currency,
  orderId,
  sessionId,
  total,
}: {
  buyer: AgenticCheckoutBuyer;
  currency: string;
  orderId: string;
  sessionId: string;
  total?: number | string;
}) {
  sendAgenticWebhook('order.created', {
    id: orderId,
    currency,
    total,
    status: 'pending',
    buyer,
  }).catch((err) =>
    logger.error({
      message: 'Webhook trigger failed',
      error: sanitizeForLog(err),
      sessionId,
    })
  );
}

export async function markAgenticCheckoutOrderCanceled({
  merchantId,
  orderId,
  supabase,
}: {
  merchantId: string;
  orderId: string;
  sessionId: string;
  supabase: SupabaseClient;
}) {
  const { data, error } = await supabase
    .from('orders')
    .update({
      payment_status: 'cancelled',
      shipping_status: 'cancelled',
    })
    .eq('id', orderId)
    .eq('merchant_id', merchantId)
    .in('payment_status', ['pending', 'unpaid'])
    .in('shipping_status', ['pending'])
    .select('id')
    .maybeSingle();

  return { error, updated: !error && !!data };
}
