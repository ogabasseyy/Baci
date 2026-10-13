import type { SupabaseClient } from '@supabase/supabase-js';

export const ORDER_BINDING_VARIANTS = [
  'base',
  'savings',
  'quiz_voucher',
  'discount_code',
] as const;

export type OrderBindingVariant = (typeof ORDER_BINDING_VARIANTS)[number];

/** Direct order RPC behind each binding variant. Same dispatch, one rule. */
export const ORDER_BINDING_RPC_NAMES: Record<OrderBindingVariant, string> = {
  base: 'create_storefront_order',
  discount_code: 'create_storefront_order_with_discount_code',
  quiz_voucher: 'create_storefront_order_with_quiz_voucher',
  savings: 'create_storefront_order_with_savings',
};

/**
 * Selects the order variant the same way the storefront route does:
 * savings first, then quiz voucher, then discount code, else base.
 */
export function selectOrderBindingVariant(input: {
  requestedSavingsRedemption: boolean;
  hasVoucherItem: boolean;
  discountCodeId: string | null | undefined;
}): OrderBindingVariant {
  if (input.requestedSavingsRedemption) return 'savings';
  if (input.hasVoucherItem) return 'quiz_voucher';
  if (input.discountCodeId) return 'discount_code';
  return 'base';
}

/**
 * Order row mirrored from the inner RPC in snake_case so route and
 * dispatch continuations read it like a direct RPC row.
 * `idempotency_replayed` tracks the binding: a replayed binding never
 * created a new order.
 */
export interface BoundOrder {
  id: string;
  order_number: string;
  tracking_token: string | null;
  subtotal: number;
  shipping_fee: number;
  discount_amount: number;
  tax_amount: number;
  total: number;
  customer_id: string | null;
  customer_email: string;
  customer_name: string;
  customer_phone: string | null;
  payment_status: string;
  shipping_status: string;
  payment_method: string;
  shipping_address: unknown;
  merchant_id: string;
  tax_basis: string;
  gift_wrapping_fee: number;
  idempotency_replayed: boolean;
}

export interface OrderBindingReceipt {
  sessionId: string;
  cartId: string;
  merchantId: string;
  checkoutGeneration: number;
  cartVersionReviewed: number;
  variant: OrderBindingVariant;
}

export type OrderBindingErrorCode =
  | 'refresh_required'
  | 'not_found'
  | 'expired'
  | 'unauthorized'
  | 'invalid_item'
  | 'order_rejected'
  | 'temporarily_unavailable';

export type SubmitCartBoundOrderResult =
  | {
      ok: true;
      order: BoundOrder;
      binding: OrderBindingReceipt;
      replayed: boolean;
    }
  | { ok: false; code: OrderBindingErrorCode; message: string };

export interface SubmitCartBoundOrderDeps {
  /** Order RPC client: route-context scoped for the storefront route. */
  client: SupabaseClient;
}

export interface SubmitCartBoundOrderInput {
  variant: OrderBindingVariant;
  sessionId: string;
  generation: number;
  /** Named inner-RPC arguments (p_merchant_id, p_items, ...). */
  args: Record<string, unknown>;
}

const BINDING_ERROR_CODES: Record<string, OrderBindingErrorCode> = {
  cart_checkout_expired: 'expired',
  cart_checkout_not_found: 'not_found',
  cart_checkout_stale: 'refresh_required',
  cart_order_invalid_variant: 'invalid_item',
  cart_order_merchant_mismatch: 'unauthorized',
  cart_order_unauthorized: 'unauthorized',
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function parseOrder(value: unknown): BoundOrder | null {
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

function parseReceipt(value: unknown): OrderBindingReceipt | null {
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
    variant: value.variant as OrderBindingVariant,
  };
}

/**
 * Submits one checkout session through the binding RPC: exactly one order
 * per generation, with the cart closed atomically on success. Binding
 * failures (stale, expired, unauthorized) map to dedicated codes; inner
 * order rejections pass through as `order_rejected` with the original
 * message so existing order error mapping still applies.
 */
export async function submitCartBoundOrder(
  deps: SubmitCartBoundOrderDeps,
  input: SubmitCartBoundOrderInput
): Promise<SubmitCartBoundOrderResult> {
  if (
    typeof input.variant !== 'string' ||
    !(ORDER_BINDING_VARIANTS as readonly string[]).includes(input.variant)
  ) {
    return {
      code: 'invalid_item',
      message: 'Unknown order variant',
      ok: false,
    };
  }
  let response: { data: unknown; error: unknown };
  try {
    response = await deps.client.rpc(
      'create_storefront_order_with_cart_binding',
      {
        p_args: input.args,
        p_generation: input.generation,
        p_session_id: input.sessionId,
        p_variant: input.variant,
      }
    );
  } catch {
    return {
      code: 'temporarily_unavailable',
      message: 'Order binding request failed',
      ok: false,
    };
  }
  if (isRecord(response.error)) {
    const message =
      typeof response.error.message === 'string' ? response.error.message : '';
    // Raised application errors arrive as P0001 with the exact code as
    // the message; anything else is a transport or database failure.
    if (response.error.code === 'P0001' && message) {
      const code = BINDING_ERROR_CODES[message];
      if (code) {
        return { code, message, ok: false };
      }
      return { code: 'order_rejected', message, ok: false };
    }
    return {
      code: 'temporarily_unavailable',
      message: message || 'Order binding request failed',
      ok: false,
    };
  }
  if (response.error) {
    return {
      code: 'temporarily_unavailable',
      message: 'Order binding request failed',
      ok: false,
    };
  }
  const data = response.data;
  if (!isRecord(data) || data.ok !== true) {
    return {
      code: 'temporarily_unavailable',
      message: 'Order binding returned a malformed receipt',
      ok: false,
    };
  }
  const order = parseOrder(data.order);
  const binding = parseReceipt(data.binding);
  if (!order || !binding) {
    return {
      code: 'temporarily_unavailable',
      message: 'Order binding returned a malformed receipt',
      ok: false,
    };
  }
  return { binding, ok: true, order, replayed: data.replayed === true };
}
