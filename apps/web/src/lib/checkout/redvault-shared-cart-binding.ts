import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { OrderBindingErrorCode } from '@/lib/cart/order-binding';
import type { OrderCreateInput } from '@/schemas/orders';

type CartBinding = NonNullable<OrderCreateInput['shared_cart']>;

export type RedvaultSharedCart = {
  binding: CartBinding;
  principalId: string | null;
};

export class RedvaultCartBindingError extends Error {
  constructor(readonly code: OrderBindingErrorCode) {
    super('Shared cart checkout failed');
  }
}

const bindingErrors: Record<string, OrderBindingErrorCode> = {
  cart_checkout_expired: 'expired',
  cart_checkout_not_found: 'not_found',
  cart_checkout_stale: 'refresh_required',
  cart_order_invalid_variant: 'invalid_item',
  cart_order_merchant_mismatch: 'unauthorized',
  cart_order_unauthorized: 'unauthorized',
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The REDVAULT inner row has a different shape from ordinary order rows. */
export async function createBoundRedvaultDraft({
  client,
  sharedCart,
  orderArgs,
  draftArgs,
}: {
  client: SupabaseClient;
  sharedCart: RedvaultSharedCart;
  orderArgs: Record<string, unknown>;
  draftArgs: Record<string, unknown>;
}): Promise<unknown> {
  const { binding, principalId } = sharedCart;
  if (!principalId) throw new RedvaultCartBindingError('unauthorized');

  let response: { data: unknown; error: unknown };
  try {
    response = await client.rpc('create_storefront_order_with_cart_binding', {
      p_args: {
        ...orderArgs,
        p_cart_id: binding.cart_id,
        p_cart_version: binding.cart_version,
        p_cart_principal_id: principalId,
        p_redvault_order: draftArgs.p_order,
        p_redvault_quote: draftArgs.p_quote,
        p_redvault_route_proof: draftArgs.p_route_proof,
      },
      p_generation: binding.checkout_generation,
      p_session_id: binding.checkout_session_id,
      p_variant: 'redvault',
    });
  } catch {
    console.error('REDVAULT cart binding unavailable', {
      stage: 'rpc_exception',
    });
    throw new RedvaultCartBindingError('temporarily_unavailable');
  }

  if (response.error) {
    if (
      isRecord(response.error) &&
      response.error.code === 'P0001' &&
      typeof response.error.message === 'string'
    ) {
      const message = response.error.message;
      if (bindingErrors[message]) {
        throw new RedvaultCartBindingError(bindingErrors[message]);
      }
      // Domain errors are mapped to a fixed customer response by the caller.
      throw new Error(message);
    }
    const code =
      isRecord(response.error) &&
      typeof response.error.code === 'string' &&
      /^[A-Z0-9]{5}$/.test(response.error.code)
        ? response.error.code
        : undefined;
    console.error('REDVAULT cart binding unavailable', {
      stage: 'rpc_error',
      code,
    });
    throw new RedvaultCartBindingError('temporarily_unavailable');
  }

  const receipt = response.data;
  if (
    !isRecord(receipt) ||
    receipt.ok !== true ||
    typeof receipt.replayed !== 'boolean' ||
    !isRecord(receipt.order) ||
    typeof receipt.order.id !== 'string' ||
    !receipt.order.id ||
    typeof receipt.order.quote_version_id !== 'string' ||
    typeof receipt.order.quote_payload_hash !== 'string' ||
    typeof receipt.order.status !== 'string' ||
    !isRecord(receipt.order.proof_context) ||
    receipt.order.idempotency_replayed !== receipt.replayed ||
    !isRecord(receipt.binding) ||
    receipt.binding.variant !== 'redvault' ||
    receipt.binding.sessionId !== binding.checkout_session_id ||
    receipt.binding.cartId !== binding.cart_id ||
    receipt.binding.merchantId !== orderArgs.p_merchant_id ||
    receipt.binding.checkout_generation !== binding.checkout_generation ||
    receipt.binding.cartVersionReviewed !== binding.cart_version
  ) {
    console.error('REDVAULT cart binding unavailable', {
      stage: 'receipt_mismatch',
    });
    throw new RedvaultCartBindingError('temporarily_unavailable');
  }
  return receipt.order;
}
