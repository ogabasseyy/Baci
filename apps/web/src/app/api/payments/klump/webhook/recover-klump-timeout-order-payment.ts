import type { SupabaseClient } from '@supabase/supabase-js';
import type { KlumpPaidOrder } from '@/lib/klump-payment-notifications';
import { logger } from '@/lib/logger';
import {
  handlePaymentForCancelledOrder,
  isOrderClampedAsCancelled,
} from '@/lib/payments/handle-payment-for-cancelled-order';
import { reinstateTimeoutOrderPayment } from '@/lib/payments/reinstate-timeout-order-payment';

export type KlumpUpdatedOrder = KlumpPaidOrder & {
  cancelled_at?: string | null;
  payment_status?: string | null;
  shipping_funding_source?: 'customer_checkout' | 'merchant_wallet' | null;
  shipping_platform_retained_amount?: number | string | null;
  shipping_provider?: string | null;
  shipping_status?: string | null;
};

export const KLUMP_PAYMENT_ORDER_SELECT =
  'id, merchant_id, order_number, customer_name, total, currency, payment_status, shipping_status, cancelled_at, shipping_provider, shipping_funding_source, shipping_platform_retained_amount';

export type KlumpTimeoutRecoveryResult =
  | { kind: 'failed'; stage: 'reinstate' | 'read' }
  | { kind: 'blocked'; reviewFiled: boolean }
  | { kind: 'reviewed'; reviewFiled: boolean }
  | { kind: 'reinstated'; order: KlumpUpdatedOrder };

export async function recoverKlumpTimeoutOrderPayment({
  order,
  reference,
  supabase,
  transaction,
}: {
  order: KlumpUpdatedOrder;
  reference: string;
  supabase: SupabaseClient;
  transaction: { id: string; merchant_id: string };
}): Promise<KlumpTimeoutRecoveryResult> {
  let reinstatement: Awaited<ReturnType<typeof reinstateTimeoutOrderPayment>>;
  try {
    reinstatement = await reinstateTimeoutOrderPayment(
      supabase,
      order.id,
      transaction.id,
      transaction.merchant_id
    );
  } catch (error) {
    logger.error({ error, message: 'Klump late payment reinstatement failed' });
    return { kind: 'failed', stage: 'reinstate' };
  }

  if (reinstatement === 'blocked') {
    const reviewFiled = await handlePaymentForCancelledOrder({
      gatewayReference: reference,
      order,
      reason:
        'Klump payment captured for an order cancelled before finalization',
      transactionId: transaction.id,
    });
    return { kind: 'blocked', reviewFiled };
  }

  const { data: reopenedOrder, error: reopenedOrderError } = await supabase
    .from('orders')
    .select(KLUMP_PAYMENT_ORDER_SELECT)
    .eq('id', order.id)
    .eq('merchant_id', transaction.merchant_id)
    .maybeSingle<KlumpUpdatedOrder>();
  if (reopenedOrderError || !reopenedOrder) {
    return { kind: 'failed', stage: 'read' };
  }

  if (
    reopenedOrder.payment_status !== 'paid' ||
    isOrderClampedAsCancelled(reopenedOrder)
  ) {
    const reviewFiled = await handlePaymentForCancelledOrder({
      gatewayReference: reference,
      issueType:
        reopenedOrder.payment_status === 'refunded'
          ? 'payment_received_after_refund'
          : undefined,
      order: reopenedOrder,
      reason: 'Klump order left the paid state before settlement',
      transactionId: transaction.id,
    });
    return { kind: 'reviewed', reviewFiled };
  }

  return { kind: 'reinstated', order: reopenedOrder };
}
