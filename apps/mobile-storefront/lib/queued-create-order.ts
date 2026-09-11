import type { CreateOrderRequest } from '@/services/orders.schemas';

export type QueuedCreateOrder = {
  checkoutGeneration: string;
  request: CreateOrderRequest;
};

export function wrapQueuedCreateOrder(
  request: CreateOrderRequest,
  checkoutGeneration: string
): QueuedCreateOrder {
  return { checkoutGeneration, request };
}

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
    return payload as QueuedCreateOrder;
  }

  return {
    checkoutGeneration: '',
    request: payload as CreateOrderRequest,
  };
}

export function replayQueuedCreateOrder(
  createOrder: (
    request: CreateOrderRequest,
    options?: { checkoutGeneration?: string }
  ) => Promise<unknown>,
  payload: unknown
) {
  const queued = parseQueuedCreateOrder(payload);
  return createOrder(
    queued.request,
    queued.checkoutGeneration
      ? { checkoutGeneration: queued.checkoutGeneration }
      : undefined
  );
}
