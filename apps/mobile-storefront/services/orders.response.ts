import type { createLogger } from '@/lib/logger';
import { trackError } from '@/services/analytics';
import { OrderError } from './orders.errors';
import { type OrderResponse, OrderResponseSchema } from './orders.schemas';

export type CreateOrderResult = OrderResponse & {
  // The generation the payload was frozen and submitted under. Rollback
  // paths must capture and restore this value — not the caller's possibly
  // stale snapshot — so a retry replays the created order instead of
  // forking the idempotency key.
  effectiveCheckoutGeneration: string;
};

type Logger = ReturnType<typeof createLogger>;

function getResponseOrderId(data: unknown): string | undefined {
  if (!data || typeof data !== 'object' || !('order' in data)) {
    return undefined;
  }
  const order = (data as { order?: unknown }).order;
  if (!order || typeof order !== 'object' || !('id' in order)) {
    return undefined;
  }
  const id = (order as { id?: unknown }).id;
  return typeof id === 'string' ? id : undefined;
}

export async function parseOrderResponse(
  response: Response,
  log: Logger
): Promise<OrderResponse> {
  let data: unknown;
  try {
    data = await response.json();
  } catch (error) {
    log.error('Failed to parse order response JSON', error);
    trackError('order_response_json_parse_failed', 'Invalid response JSON', {
      status: response.status,
    });
    throw new OrderError(
      'Unable to process server response. Please check your order history.',
      'RESPONSE_PARSE_ERROR',
      error
    );
  }

  const orderResponse = OrderResponseSchema.safeParse(data);

  if (!orderResponse.success) {
    log.error('Response schema validation failed', orderResponse.error);
    trackError('order_response_validation_failed', 'Invalid response schema', {
      orderId: getResponseOrderId(data),
      validationErrors: orderResponse.error.flatten(),
    });

    throw new OrderError(
      'Order may have been created but response format is invalid. Please check your order history.',
      'RESPONSE_VALIDATION_ERROR',
      orderResponse.error
    );
  }

  return {
    ...orderResponse.data,
    order: {
      ...orderResponse.data.order,
      created_at:
        orderResponse.data.order.created_at ?? new Date().toISOString(),
    },
  };
}
