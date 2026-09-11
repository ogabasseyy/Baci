import { parseQueuedCreateOrder } from '@/lib/parse-queued-create-order';
import type { CreateOrderRequest } from '@/services/orders.schemas';

export function replayQueuedCreateOrder(
  createOrder: (
    request: CreateOrderRequest,
    options?: { checkoutGeneration?: string; queuedReplay?: boolean }
  ) => Promise<unknown>,
  payload: unknown
) {
  const queued = parseQueuedCreateOrder(payload);
  return createOrder(
    queued.request,
    queued.checkoutGeneration
      ? {
          checkoutGeneration: queued.checkoutGeneration,
          queuedReplay: true,
        }
      : undefined
  );
}
