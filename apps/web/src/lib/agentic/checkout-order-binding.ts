import type { SupabaseClient } from '@supabase/supabase-js';
import { submitCartBoundOrder } from '@/lib/cart/order-binding';

export interface AgenticCheckoutOrderResult {
  data: Record<string, unknown>;
  error?: string;
  ok: boolean;
  orderId?: string;
  status: number;
  statusText: string;
}

export interface SharedCartBindingRef {
  cart_id: string;
  cart_version: number;
  checkout_generation: number;
  checkout_session_id: string;
}

export type SharedCartBindingOutcome =
  | { kind: 'failure'; result: AgenticCheckoutOrderResult }
  | {
      kind: 'resolved';
      data: unknown;
      error: { code?: unknown; message?: unknown } | null;
    };

function boundOrderFailureResult(code: string): AgenticCheckoutOrderResult {
  if (code === 'unauthorized') {
    return {
      data: { error: 'Shared cart binding is not permitted for this caller' },
      error: 'Shared cart binding is not permitted for this caller',
      ok: false,
      orderId: undefined,
      status: 403,
      statusText: 'Forbidden',
    };
  }
  if (code === 'invalid_item') {
    return {
      data: { error: 'Unable to create order' },
      error: 'Unable to create order',
      ok: false,
      orderId: undefined,
      status: 500,
      statusText: 'Internal Server Error',
    };
  }
  const error =
    code === 'expired'
      ? 'Shared checkout session expired; review the cart again'
      : code === 'not_found'
        ? 'Shared checkout session not found; start checkout again'
        : 'Shared cart changed during checkout; refresh the cart and retry';
  return {
    data: { error },
    error,
    ok: false,
    orderId: undefined,
    status: 409,
    statusText: 'Conflict',
  };
}

/**
 * Shared-cart checkouts submit through the binding RPC, which runs the
 * base order RPC inside the final transaction and closes the reviewed
 * cart generation atomically. Binding-level failures return early;
 * inner order rejections are reported as a resolved outcome so the
 * caller maps them exactly like a direct RPC rejection.
 */
export async function submitSharedCartBindingOrder(input: {
  supabase: SupabaseClient;
  sharedCart: SharedCartBindingRef;
  orderRpcArgs: Record<string, unknown>;
  boundPrincipalId?: string | null;
}): Promise<SharedCartBindingOutcome> {
  const bound = await submitCartBoundOrder(
    { client: input.supabase },
    {
      args: input.orderRpcArgs,
      cartId: input.sharedCart.cart_id,
      cartVersion: input.sharedCart.cart_version,
      generation: input.sharedCart.checkout_generation,
      principalId: input.boundPrincipalId ?? null,
      sessionId: input.sharedCart.checkout_session_id,
      variant: 'base',
    }
  );
  if (
    !bound.ok &&
    bound.code === 'order_rejected' &&
    bound.message === 'cart_order_voucher_authority_required'
  ) {
    const error = 'Complete voucher checkout on the storefront website.';
    return {
      kind: 'failure',
      result: {
        data: { error, code: 'voucher_checkout_requires_website' },
        error,
        ok: false,
        status: 409,
        statusText: 'Conflict',
      },
    };
  }
  if (
    !bound.ok &&
    bound.code !== 'order_rejected' &&
    bound.code !== 'temporarily_unavailable'
  ) {
    return { kind: 'failure', result: boundOrderFailureResult(bound.code) };
  }
  return {
    kind: 'resolved',
    data: bound.ok ? bound.order : null,
    error: bound.ok
      ? null
      : // Inner rejections reuse the direct-path shape (code carries
        // the message) so the caller's mapper behaves identically.
        bound.code === 'order_rejected'
        ? { code: bound.message, message: bound.message }
        : { code: 'XX000', message: bound.message },
  };
}
