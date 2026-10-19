import {
  type BoundOrder,
  ORDER_BINDING_VARIANTS,
  type OrderBindingReceipt,
} from './order-binding-types';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** Parses the inner-RPC order row mirrored in snake_case, or null. */
export function parseBoundOrder(value: unknown): BoundOrder | null {
  if (!isRecord(value)) return null;
  if (
    typeof value.id !== 'string' ||
    !value.id ||
    typeof value.order_number !== 'string' ||
    !value.order_number ||
    typeof value.subtotal !== 'number' ||
    typeof value.shipping_fee !== 'number' ||
    typeof value.discount_amount !== 'number' ||
    typeof value.tax_amount !== 'number' ||
    typeof value.total !== 'number' ||
    typeof value.customer_email !== 'string' ||
    typeof value.customer_name !== 'string' ||
    typeof value.payment_status !== 'string' ||
    typeof value.shipping_status !== 'string' ||
    typeof value.payment_method !== 'string' ||
    typeof value.merchant_id !== 'string' ||
    typeof value.tax_basis !== 'string' ||
    typeof value.gift_wrapping_fee !== 'number'
  ) {
    return null;
  }
  return {
    customer_email: value.customer_email,
    customer_id:
      typeof value.customer_id === 'string' ? value.customer_id : null,
    customer_name: value.customer_name,
    customer_phone:
      typeof value.customer_phone === 'string' ? value.customer_phone : null,
    discount_amount: value.discount_amount,
    gift_wrapping_fee: value.gift_wrapping_fee,
    id: value.id,
    idempotency_replayed: value.idempotency_replayed === true,
    merchant_id: value.merchant_id,
    order_number: value.order_number,
    payment_method: value.payment_method,
    payment_status: value.payment_status,
    ...(typeof value.savings_redemption_success === 'boolean'
      ? { savings_redemption_success: value.savings_redemption_success }
      : {}),
    ...(typeof value.savings_redeemed_amount === 'number'
      ? { savings_redeemed_amount: value.savings_redeemed_amount }
      : {}),
    ...(typeof value.savings_goal_id === 'string'
      ? { savings_goal_id: value.savings_goal_id }
      : {}),
    ...(typeof value.savings_redemption_id === 'string'
      ? { savings_redemption_id: value.savings_redemption_id }
      : {}),
    ...(typeof value.savings_goal_status === 'string'
      ? { savings_goal_status: value.savings_goal_status }
      : {}),
    shipping_address: value.shipping_address ?? null,
    shipping_fee: value.shipping_fee,
    shipping_status: value.shipping_status,
    subtotal: value.subtotal,
    tax_amount: value.tax_amount,
    tax_basis: value.tax_basis,
    total: value.total,
    tracking_token:
      typeof value.tracking_token === 'string' ? value.tracking_token : null,
  };
}

/** Parses the binding receipt echoed by the wrapper RPC, or null. */
export function parseOrderBindingReceipt(
  value: unknown
): OrderBindingReceipt | null {
  if (!isRecord(value)) return null;
  if (
    typeof value.sessionId !== 'string' ||
    typeof value.cartId !== 'string' ||
    typeof value.merchantId !== 'string' ||
    typeof value.checkout_generation !== 'number' ||
    !Number.isInteger(value.checkout_generation) ||
    typeof value.cartVersionReviewed !== 'number' ||
    !Number.isInteger(value.cartVersionReviewed) ||
    typeof value.variant !== 'string' ||
    !(ORDER_BINDING_VARIANTS as readonly string[]).includes(value.variant)
  ) {
    return null;
  }
  return {
    cartId: value.cartId,
    cartVersionReviewed: value.cartVersionReviewed,
    checkoutGeneration: value.checkout_generation,
    merchantId: value.merchantId,
    sessionId: value.sessionId,
    variant: value.variant as OrderBindingReceipt['variant'],
  };
}
