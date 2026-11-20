import type { buildChatwootCheckoutOrderRequest } from './chatwoot-checkout-order-request';
import type {
  ChatwootCheckoutCreatedOrder,
  ChatwootCheckoutFailureCode,
} from './chatwoot-checkout-result';

export type ChatwootCheckoutOrderOutcome =
  | { ok: true; order: ChatwootCheckoutCreatedOrder }
  | { ok: false; code: ChatwootCheckoutFailureCode };

const DELIVERY_REJECTION_CODES = new Set([
  'SHIPPING_FEE_MISMATCH',
  'SHIPPING_RATE_INVALID',
  'SHIPPING_RATE_ZONE_MISMATCH',
  'SHIPPING_RATE_CONDITION_UNMET',
]);
const CART_REJECTION_CODES = new Set([
  'CHECKOUT_IDEMPOTENCY_CONFLICT',
  'CHECKOUT_ORDER_NOT_REUSABLE',
]);

function failureCode(body: unknown): ChatwootCheckoutFailureCode {
  const code =
    body && typeof body === 'object'
      ? (body as { code?: unknown }).code
      : undefined;
  if (typeof code !== 'string') return 'order_failed';
  if (DELIVERY_REJECTION_CODES.has(code)) return 'delivery_unavailable';
  if (CART_REJECTION_CODES.has(code)) return 'cart_changed';
  return 'order_failed';
}

/** POSTs the order with the derived key; only bounded fields leave this module. */
export async function postChatwootCheckoutOrder(
  orderRequest: ReturnType<typeof buildChatwootCheckoutOrderRequest>,
  idempotencyKey: string
): Promise<ChatwootCheckoutOrderOutcome> {
  let response: Response;
  try {
    response = await fetch('/api/orders', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': idempotencyKey,
      },
      body: JSON.stringify(orderRequest),
    });
  } catch {
    return { ok: false, code: 'order_failed' };
  }
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) return { ok: false, code: failureCode(body) };

  const result = body as {
    order?: {
      id?: unknown;
      order_number?: unknown;
      total?: unknown;
      tracking_token?: unknown;
      currency?: unknown;
    };
    amountDueToGateway?: unknown;
  } | null;
  const order = result?.order;
  const amountDue = result?.amountDueToGateway ?? order?.total;
  if (
    !order ||
    typeof order.id !== 'string' ||
    typeof order.order_number !== 'string' ||
    typeof amountDue !== 'number' ||
    !Number.isFinite(amountDue) ||
    amountDue <= 0
  ) {
    return { ok: false, code: 'order_failed' };
  }
  return {
    ok: true,
    order: {
      orderId: order.id,
      orderNumber: order.order_number,
      trackingToken:
        typeof order.tracking_token === 'string' && order.tracking_token.trim()
          ? order.tracking_token
          : null,
      amountDueMajor: amountDue,
      currency:
        typeof order.currency === 'string'
          ? order.currency.trim().toUpperCase()
          : null,
    },
  };
}
