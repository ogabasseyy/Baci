import { NextResponse } from 'next/server';
import type { OrderCreateInput } from '@/schemas/orders';
import {
  type SubmitCartBoundOrderDeps,
  type SubmitCartBoundOrderInput,
  type SubmitCartBoundOrderResult,
  submitCartBoundOrder,
} from './order-binding';
import {
  requestCarriesSharedCartSessionProof,
  requestPresentsCartProofMaterial,
  verifySharedCartOrderProof,
} from './order-proof';

type OrderCartBinding = OrderCreateInput['shared_cart'];

/** Establish preparing-principal authority before any checkout side effects. */
export function getSharedCartOrderAuthority(
  request: Request,
  binding: OrderCartBinding,
  merchantId: string,
  options?: { sharedCartEnrolled?: boolean }
):
  | { ok: true; principalId: string | null }
  | { ok: false; response: NextResponse } {
  if (!binding) {
    if (options?.sharedCartEnrolled === false) {
      return { ok: true, principalId: null };
    }
    // A request carrying shared-cart session authority must submit
    // its reviewed checkout binding; without one it must not fall
    // through to the legacy direct order path. Presented but expired
    // or invalid cart material fails closed the same way — only a
    // request with no cart credential at all is a legacy guest.
    if (
      requestCarriesSharedCartSessionProof(request, merchantId) ||
      requestPresentsCartProofMaterial(request, merchantId)
    ) {
      return {
        ok: false,
        response: NextResponse.json(
          {
            code: 'SHARED_CART_BINDING_REQUIRED',
            error:
              'This order must be submitted from your reviewed cart. Return to your cart and submit again.',
          },
          { status: 401 }
        ),
      };
    }
    return { ok: true, principalId: null };
  }
  const proof = verifySharedCartOrderProof(request, {
    cartId: binding.cart_id,
    merchantId,
  });
  if (proof.ok) return { ok: true, principalId: proof.principalId };
  return {
    ok: false,
    response: NextResponse.json(
      {
        code: 'SHARED_CART_PROOF_REQUIRED',
        error:
          'This checkout session belongs to another shopper. Review your cart and submit again.',
      },
      { status: 401 }
    ),
  };
}

/**
 * Resolves shared-cart order authority, consulting merchant enrollment only
 * when an unbound order request presents a leftover cart cookie/proof.
 */
export async function resolveSharedCartOrderAuthority(
  request: Request,
  binding: OrderCartBinding,
  merchantId: string,
  isSharedCartEnrolled?: () => Promise<boolean> | boolean
): Promise<
  | { ok: true; principalId: string | null }
  | { ok: false; response: NextResponse }
> {
  const initial = getSharedCartOrderAuthority(request, binding, merchantId);
  if (initial.ok || binding || !isSharedCartEnrolled) {
    return initial;
  }
  const sharedCartEnrolled = await isSharedCartEnrolled();
  return getSharedCartOrderAuthority(request, binding, merchantId, {
    sharedCartEnrolled,
  });
}

/** Binding failures stop checkout; inner order errors retain the legacy mapper. */
export async function submitSharedCartOrderBinding(
  deps: SubmitCartBoundOrderDeps,
  input: { binding: OrderCartBinding; principalId: string | null } & Pick<
    SubmitCartBoundOrderInput,
    'args' | 'variant'
  >
): Promise<{
  bound: SubmitCartBoundOrderResult | null;
  failure: NextResponse | null;
}> {
  const binding = input.binding;
  const bound = binding
    ? await submitCartBoundOrder(deps, {
        args: input.args,
        cartId: binding.cart_id,
        cartVersion: binding.cart_version,
        generation: binding.checkout_generation,
        principalId: input.principalId,
        sessionId: binding.checkout_session_id,
        variant: input.variant,
      })
    : null;
  return {
    bound,
    failure:
      bound && !bound.ok && bound.code !== 'order_rejected'
        ? NextResponse.json(sharedCartBindingFailureBody(bound.code), {
            status: sharedCartBindingFailureStatus(bound.code),
          })
        : null,
  };
}

function sharedCartBindingFailureStatus(code: string): number {
  switch (code) {
    case 'temporarily_unavailable':
      return 503;
    case 'unauthorized':
      return 403;
    case 'invalid_item':
      // A malformed or unknown-variant bound submission is shopper
      // input, not a server fault (matches the cart API's 400).
      return 400;
    default:
      return 409;
  }
}

function sharedCartBindingFailureBody(code: string): Record<string, string> {
  switch (code) {
    case 'temporarily_unavailable':
      return {
        code: 'SHARED_CART_TEMPORARILY_UNAVAILABLE',
        error:
          'Shared cart checkout is temporarily unavailable. Please try again.',
      };
    case 'refresh_required':
      return {
        code: 'SHARED_CART_STALE',
        error:
          'Your cart changed during checkout. Refresh to review the latest cart.',
      };
    case 'not_found':
      return {
        code: 'SHARED_CART_SESSION_NOT_FOUND',
        error:
          'This checkout session is no longer available. Start checkout again.',
      };
    case 'expired':
      return {
        code: 'SHARED_CART_SESSION_EXPIRED',
        error: 'This checkout session expired. Review your cart again.',
      };
    case 'unauthorized':
      return {
        code: 'SHARED_CART_BINDING_FORBIDDEN',
        error: 'This cart cannot be submitted for checkout.',
      };
    default:
      return {
        code: 'SHARED_CART_BINDING_FAILED',
        error: 'Failed to submit the shared cart. Please try again.',
      };
  }
}
