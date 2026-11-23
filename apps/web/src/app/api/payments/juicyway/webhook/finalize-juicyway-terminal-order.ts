import type { SupabaseClient } from '@supabase/supabase-js';
import type { FinalizeOrderGatewayPaymentTransaction } from '@/lib/payments/finalize-order-gateway-payment';
import { finalizeOrderGatewayPayment } from '@/lib/payments/finalize-order-gateway-payment';
import { isOrderClampedAsCancelled } from '@/lib/payments/handle-payment-for-cancelled-order';

type TerminalOrder = {
  cancelled_at: string | null;
  id: string;
  order_number: string | null;
  payment_status: string;
  shipping_status: string | null;
};

export type JuicywayTerminalOrderResult =
  | { kind: 'failed'; stage: 'lookup' | 'finalization' }
  | { kind: 'not_cancelled'; order: TerminalOrder | null }
  | { kind: 'completed' | 'order_cancelled' };

export async function finalizeJuicywayTerminalOrder({
  gatewayResponse,
  orderId,
  reference,
  scheduleAfter,
  supabase,
  transaction,
}: {
  gatewayResponse: Record<string, unknown>;
  orderId: string;
  reference: string;
  scheduleAfter: (task: () => Promise<void>) => void;
  supabase: SupabaseClient;
  transaction: FinalizeOrderGatewayPaymentTransaction;
}): Promise<JuicywayTerminalOrderResult> {
  const { data: terminalOrder, error } = await supabase
    .from('orders')
    .select('id, payment_status, shipping_status, cancelled_at, order_number')
    .eq('id', orderId)
    .eq('merchant_id', transaction.merchant_id)
    .maybeSingle<TerminalOrder>();
  if (error || !terminalOrder) return { kind: 'failed', stage: 'lookup' };

  if (
    !isOrderClampedAsCancelled(terminalOrder) &&
    !['cancelled', 'canceled'].includes(terminalOrder.payment_status)
  ) {
    return { kind: 'not_cancelled', order: terminalOrder };
  }

  const finalization = await finalizeOrderGatewayPayment({
    actor: 'juicyway:late_payment',
    gateway: 'juicyway',
    gatewayResponse,
    orderId,
    reference,
    scheduleAfter,
    supabase,
    transaction,
    wonTransactionFlip: false,
  });
  if (finalization.kind === 'order_cancelled') {
    return { kind: 'order_cancelled' };
  }
  return finalization.kind === 'completed'
    ? { kind: 'completed' }
    : { kind: 'failed', stage: 'finalization' };
}
