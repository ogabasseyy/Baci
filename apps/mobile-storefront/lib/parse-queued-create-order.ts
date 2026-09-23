import type { QueuedCreateOrder } from '@/lib/wrap-queued-create-order';
import type { CreateOrderRequest } from '@/services/orders.schemas';

export function parseQueuedCreateOrder(payload: unknown): QueuedCreateOrder {
  if (
    payload !== null &&
    typeof payload === 'object' &&
    'request' in payload &&
    'checkoutGeneration' in payload &&
    typeof (payload as QueuedCreateOrder).checkoutGeneration === 'string' &&
    (payload as QueuedCreateOrder).request !== null &&
    typeof (payload as QueuedCreateOrder).request === 'object'
  ) {
    const queued = payload as QueuedCreateOrder;
    return {
      authPartition:
        typeof queued.authPartition === 'string' ? queued.authPartition : '',
      checkoutGeneration: queued.checkoutGeneration,
      request: queued.request,
    };
  }

  return {
    authPartition: '',
    checkoutGeneration: '',
    request: payload as CreateOrderRequest,
  };
}
