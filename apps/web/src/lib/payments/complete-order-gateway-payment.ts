import type { SupabaseClient } from '@supabase/supabase-js';
import {
  type OrderGatewayPaymentCompletion,
  orderGatewayPaymentCompletionSchema,
} from '@/schemas/order-gateway-payment-completion';

export type CompleteOrderGatewayPaymentResult =
  | { ok: true; completion: OrderGatewayPaymentCompletion }
  | { ok: false; error: unknown };

// Thin, typed wrapper around the `complete_order_gateway_payment` RPC. The
// RPC is GRANTed to service_role only — pass a service-role client
// (createServiceClient from @/lib/supabase/service); any other client gets a
// forbidden error from the database. The
// RPC performs the transaction flip and the order flip in ONE database
// transaction and is idempotent for replays, which is what heals orders that
// previously wedged between the two writes.
export async function completeOrderGatewayPayment({
  supabase,
  transactionId,
  orderId,
  gatewayResponse,
  actor,
  expectedOutstandingMinor,
}: {
  supabase: SupabaseClient;
  transactionId: string;
  orderId: string;
  gatewayResponse: Record<string, unknown> | null;
  actor: string;
  /**
   * Outstanding balance (minor units) observed by the caller before
   * completion. When set, the RPC recomputes the outstanding under
   * its order lock and returns BALANCE_CHANGED instead of promoting
   * when the balance moved. Unset preserves the legacy behavior.
   */
  expectedOutstandingMinor?: number | null;
}): Promise<CompleteOrderGatewayPaymentResult> {
  const { data, error } = await supabase.rpc('complete_order_gateway_payment', {
    p_actor: actor,
    p_gateway_response: gatewayResponse,
    p_order_id: orderId,
    p_transaction_id: transactionId,
    p_expected_outstanding_minor: expectedOutstandingMinor ?? null,
  });

  if (error) {
    return { error, ok: false };
  }

  const parsed = orderGatewayPaymentCompletionSchema.safeParse(data);
  if (!parsed.success) {
    return { error: parsed.error, ok: false };
  }

  return { completion: parsed.data, ok: true };
}
