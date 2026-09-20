import { financialConsistency } from '@/lib/payments/financial-consistency';
import { buildSettlementExecutor } from '@/lib/payments/paid-order-settlement-executor';
import type { RunPaidOrderSideEffectsArgs } from '@/lib/payments/paid-order-side-effect-types';
import { toPaidOrder } from '@/lib/payments/run-paid-order-side-effects';

// Settlement for a gateway capture that landed on an order ALREADY paid
// through another channel. This must NOT go through the paid-order outbox:
// `payment_side_effects` is keyed on (order_id, step), so the earlier
// payment's completed `merchant_settlement` row would make the claim lose
// and this transaction's funds would never settle. `record_merchant_settlement`
// is itself idempotent on (source_type, source_id, gateway_reference), and
// this capture carries its own reference, so calling the executor directly is
// both safe to retry and correct.
export async function settleCapturedOrderPayment(
  args: RunPaidOrderSideEffectsArgs
): Promise<void> {
  const executor = buildSettlementExecutor({
    ...args,
    orderPaymentMethod: args.order.payment_method ?? null,
  });
  const order = toPaidOrder(args.order);
  await executor({
    consistency: financialConsistency(order),
    gatewayResponse: args.gatewayResponse,
    order,
    transaction: {
      amount: args.transaction.amount,
      gateway_reference: args.transaction.gateway_reference ?? null,
      id: args.transaction.id,
      merchant_id: args.transaction.merchant_id,
      order_id: args.transaction.order_id,
    },
  });
}
