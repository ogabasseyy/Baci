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
