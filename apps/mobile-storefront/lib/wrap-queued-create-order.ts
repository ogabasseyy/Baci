import type { CreateOrderRequest } from '@/services/orders.schemas';

export type QueuedCreateOrder = {
  authPartition: string;
  checkoutGeneration: string;
  request: CreateOrderRequest;
};

export function wrapQueuedCreateOrder(
  request: CreateOrderRequest,
  checkoutGeneration: string,
  authPartition: string
): QueuedCreateOrder {
  return { authPartition, checkoutGeneration, request };
}
