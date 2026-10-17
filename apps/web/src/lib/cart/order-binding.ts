import type { SupabaseClient } from '@supabase/supabase-js';

import {
  parseBoundOrder as parseOrder,
  parseOrderBindingReceipt as parseReceipt,
} from './order-binding-parsing';
import {
  type BoundOrder,
  ORDER_BINDING_VARIANTS,
  type OrderBindingErrorCode,
  type OrderBindingReceipt,
  type OrderBindingVariant,
} from './order-binding-types';

export type {
  BoundOrder,
  OrderBindingErrorCode,
  OrderBindingReceipt,
  OrderBindingVariant,
} from './order-binding-types';
export { ORDER_BINDING_VARIANTS };

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

export type SubmitCartBoundOrderResult =
  | {
      ok: true;
      order: BoundOrder;
      binding: OrderBindingReceipt;
      replayed: boolean;
    }
  | {
      ok: false;
      code: OrderBindingErrorCode;
      message: string;
      sqlState?: string;
    };

export interface SubmitCartBoundOrderDeps {
  /** Order RPC client: route-context scoped for the storefront route. */
  client: SupabaseClient;
}

export interface SubmitCartBoundOrderInput {
  variant: OrderBindingVariant;
  sessionId: string;
  generation: number;
  /** Reviewed cart identity from the submitted binding; checked in SQL. */
  cartId?: string;
  cartVersion?: number;
  /**
   * Verified preparing principal (orders route only, after cart-proof
   * verification). Platform-delegated agentic submits omit it.
   */
  principalId?: string | null;
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
        p_args: {
          ...input.args,
          ...(input.cartId ? { p_cart_id: input.cartId } : {}),
          ...(input.cartVersion !== undefined
            ? { p_cart_version: input.cartVersion }
            : {}),
          ...(input.principalId
            ? { p_cart_principal_id: input.principalId }
            : {}),
        },
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
    // A permission-denied failure is a server authorization or grant
    // misconfiguration, never shopper input: surface a fixed platform
    // failure and keep the raw database detail server-side only.
    if (response.error.code === '42501') {
      return {
        code: 'temporarily_unavailable',
        message: 'Order binding request failed',
        ok: false,
      };
    }
    // Inner order RPCs also raise domain SQLSTATEs (for example the
    // airport-quote trigger's 22023). Those are order rejections, not
    // platform failures: preserve the original code and message so the
    // orders route's existing error mapper produces the same domain
    // response as the direct (unbound) path.
    if (
      typeof response.error.code === 'string' &&
      message &&
      response.error.code.startsWith('22')
    ) {
      return {
        code: 'order_rejected',
        message,
        ok: false,
        sqlState: response.error.code,
      };
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
