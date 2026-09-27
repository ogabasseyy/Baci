import type { CreateOrderResult } from '@/services/orders.response';

export function createOrderResponseFixture(
  overrides: {
    effectiveCheckoutGeneration?: string;
    orderId?: string;
    orderNumber?: string;
    replayed?: boolean;
  } = {}
): CreateOrderResult {
  // Shared synthesized order response for submit-flow tests: the
  // submitted generation travels with the response so rollback recovery
  // replays the created order instead of forking the idempotency key.
  const {
    effectiveCheckoutGeneration = 'gen-1',
    orderId = 'order-1',
    orderNumber = 'ORD-1',
    replayed = false,
  } = overrides;
  return {
    amountDueToGateway: 1201500,
    effectiveCheckoutGeneration,
    idempotency: { replayed },
    order: {
      created_at: '2026-07-09T12:00:00.000Z',
      id: orderId,
      order_number: orderNumber,
      payment_status: 'pending',
      shipping_status: 'pending',
      total: 1201500,
    },
    wallet: null,
  } as CreateOrderResult;
}
