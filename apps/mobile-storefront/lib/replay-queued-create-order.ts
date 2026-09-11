import { DeferredOfflineMutationError } from '@/lib/deferred-offline-mutation-error';
import { parseQueuedCreateOrder } from '@/lib/parse-queued-create-order';
import { queuedCreateOrderOwnerMismatch } from '@/lib/queued-create-order-owner';
import type { CreateOrderRequest } from '@/services/orders.schemas';

export function replayQueuedCreateOrder(
  createOrder: (
    request: CreateOrderRequest,
    options?: { checkoutGeneration?: string; queuedReplay?: boolean }
  ) => Promise<unknown>,
  payload: unknown,
  currentUserId?: string
) {
  const queued = parseQueuedCreateOrder(payload);
  if (queuedCreateOrderOwnerMismatch(queued.authPartition, currentUserId)) {
    return Promise.reject(
      new DeferredOfflineMutationError(
        'Queued checkout belongs to a different account'
      )
    );
  }
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
