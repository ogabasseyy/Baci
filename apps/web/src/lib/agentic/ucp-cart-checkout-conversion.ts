import { randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { calculateCheckoutSession } from '@/lib/agentic/checkout';
import { buildCheckoutSessionStateResponse } from '@/lib/agentic/checkout-session-response';
import {
  buildCheckoutSessionInsert,
  mapCheckoutSessionStatus,
} from '@/lib/agentic/checkout-storage';
import { reserveAgenticIdempotencyKey } from '@/lib/agentic/idempotency';
import { getAgenticIdempotencyErrorStatus } from '@/lib/agentic/idempotency-response';
import { buildStoredAgenticIdempotencyResponse } from '@/lib/agentic/idempotency-response-storage';
import {
  AGENTIC_CHECKOUT_DISABLED_ERROR,
  type AgenticMerchantContext,
  isAgenticMerchantCheckoutEnabled,
} from '@/lib/agentic/merchant-context';
import type { AgenticMutationRequest } from '@/lib/agentic/mutation-request';
import { reserveAgenticRequestId } from '@/lib/agentic/request-replay';
import { getAgenticReplayErrorStatus } from '@/lib/agentic/request-replay-response';
import { handleCanonicalUcpCart } from '@/lib/agentic/ucp-canonical-cart';
import {
  buildCheckoutResponseFromSession,
  loadCheckoutSessionByRowId,
  resolvePolicyBaseUrl,
} from '@/lib/agentic/ucp-cart-checkout-response';
import { ucpCartMigrationRaceOutcome } from '@/lib/agentic/ucp-cart-migration-race';
import { loadUcpCartSession } from '@/lib/agentic/ucp-cart-route-support';
import {
  buildUcpCartCheckoutLinkUpdate,
  coerceNullableJsonRecord,
  coerceUcpCartItems,
  UcpCartMigratedError,
  ucpCartCallerMismatch,
} from '@/lib/agentic/ucp-cart-storage';
import { logger } from '@/lib/logger';
import { sanitizeForLog } from '@/lib/sanitize-core';

const CART_TO_CHECKOUT_ROUTE = 'carts.checkout';

type SuccessfulAgenticMutation = Extract<AgenticMutationRequest, { ok: true }>;

export async function convertUcpCartToCheckout({
  cartId,
  merchant,
  mutation,
  requestUrl,
  supabase,
}: {
  cartId: string;
  merchant: AgenticMerchantContext;
  mutation: SuccessfulAgenticMutation;
  requestUrl: string;
  supabase: SupabaseClient;
}): Promise<NextResponse> {
  const idempotency = await reserveAgenticIdempotencyKey({
    agentId: mutation.agentId,
    apiVersion: mutation.apiVersion,
    body: mutation.rawBody,
    key: mutation.idempotencyKey,
    merchantId: merchant.id,
    method: mutation.method,
    pathname: mutation.pathname,
    route: CART_TO_CHECKOUT_ROUTE,
    supabase,
  });
  if (!idempotency.ok) {
    return NextResponse.json(
      { error: idempotency.error },
      { status: getAgenticIdempotencyErrorStatus(idempotency.error) }
    );
  }
  if (idempotency.state === 'replay') {
    return NextResponse.json(idempotency.response, {
      headers: {
        'idempotency-key': mutation.idempotencyKey,
        'request-id': mutation.requestId,
      },
      status: idempotency.status,
    });
  }

  const respond = (response: unknown, status: number) =>
    buildStoredAgenticIdempotencyResponse({
      agentId: mutation.agentId,
      idempotencyKey: mutation.idempotencyKey,
      merchantId: merchant.id,
      requestId: mutation.requestId,
      response,
      route: CART_TO_CHECKOUT_ROUTE,
      status,
      storageFailureResponse: { error: 'Idempotency response storage failed' },
      supabase,
    });

  if (!isAgenticMerchantCheckoutEnabled(merchant)) {
    return respond({ error: AGENTIC_CHECKOUT_DISABLED_ERROR }, 403);
  }

  const replayReservation = await reserveAgenticRequestId({
    agentId: mutation.agentId,
    apiVersion: mutation.apiVersion,
    idempotencyKey: mutation.idempotencyKey,
    merchantId: merchant.id,
    requestId: mutation.requestId,
    route: CART_TO_CHECKOUT_ROUTE,
    supabase,
  });
  if (!replayReservation.ok) {
    return respond(
      { error: replayReservation.error },
      getAgenticReplayErrorStatus(replayReservation.error)
    );
  }

  const canonical = await handleCanonicalUcpCart({
    merchant,
    cartId,
    agentId: mutation.agentId,
    action: 'checkout',
    operationId: mutation.idempotencyKey,
  });
  if (canonical) return respond(canonical.body, canonical.status);

  const cartResult = await loadUcpCartSession({
    cartId,
    merchantId: merchant.id,
    supabase,
  });
  if (cartResult.error) {
    logger.error({
      error: sanitizeForLog(cartResult.error),
      merchantId: merchant.id,
      message: 'Failed to load UCP cart for checkout conversion',
      route: CART_TO_CHECKOUT_ROUTE,
    });
    return respond({ error: 'Database error' }, 500);
  }
  if (!cartResult.cart) return respond({ error: 'Cart not found' }, 404);
  if (
    ucpCartCallerMismatch(cartResult.cart, mutation.agentId, { mutation: true })
  ) {
    return respond({ error: 'Cart not found' }, 404);
  }

  // A migrated cart is retired: its authority moved to the shared
  // canonical cart, so the legacy conversion path must not create an
  // (unbound) order for it. The caller refreshes onto the canonical
  // cart and checks out there with the cart binding instead.
  if (cartResult.cart.migratedToCartId) {
    const migrated = new UcpCartMigratedError(cartResult.cart.migratedToCartId);
    return respond(
      {
        cart_id: migrated.cartId,
        code: migrated.code,
        error: migrated.message,
      },
      409
    );
  }

  if (cartResult.cart.status === 'converted') {
    if (!cartResult.cart.checkout_session_id) {
      return respond({ error: 'Converted cart is missing checkout link' }, 409);
    }
    const existing = await loadCheckoutSessionByRowId({
      merchantId: merchant.id,
      rowId: cartResult.cart.checkout_session_id,
      supabase,
    });
    if (existing.error) return respond({ error: 'Database error' }, 500);
    if (!existing.session) {
      return respond({ error: 'Checkout session not found' }, 404);
    }

    return respond(
      await buildCheckoutResponseFromSession({
        merchant,
        requestUrl,
        session: existing.session,
        supabase,
      }),
      200
    );
  }

  if (cartResult.cart.status !== 'active') {
    return respond(
      { error: 'Cart cannot be converted', status: cartResult.cart.status },
      409
    );
  }

  const items = coerceUcpCartItems(cartResult.cart.cart_items);
  const shippingAddress = coerceNullableJsonRecord(
    cartResult.cart.shipping_address
  );
  const sessionCalc = await calculateCheckoutSession(
    supabase,
    items,
    null,
    cartResult.cart.currency,
    merchant.id
  );
  if (sessionCalc.lineItems.length === 0) {
    return respond(
      { error: 'No valid cart items', messages: sessionCalc.messages },
      400
    );
  }

  const sessionId = `agentic_${randomUUID()}`;
  const fulfillmentOptionId = sessionCalc.selectedOptionId ?? null;
  const insertPayload = buildCheckoutSessionInsert({
    currency: cartResult.cart.currency,
    fulfillmentAddress: shippingAddress,
    fulfillmentOptionId,
    fulfillmentOptions: sessionCalc.fulfillmentOptions,
    items,
    lineItems: sessionCalc.lineItems,
    merchantId: merchant.id,
    messages: sessionCalc.messages,
    sessionId,
    totals: sessionCalc.totals,
  });
  const { data: session, error } = await supabase
    .from('checkout_sessions')
    .insert(insertPayload)
    .select('id, session_id')
    .single();
  if (error || !session) {
    logger.error({
      error: sanitizeForLog(error),
      merchantId: merchant.id,
      message: 'Failed to create checkout session from UCP cart',
      route: CART_TO_CHECKOUT_ROUTE,
    });
    return respond({ error: 'Database error' }, 500);
  }

  const { data: updatedCart, error: updateError } = await supabase
    .from('agentic_cart_sessions')
    .update(buildUcpCartCheckoutLinkUpdate({ checkoutSessionId: session.id }))
    .eq('cart_id', cartId)
    .eq('merchant_id', merchant.id)
    .eq('status', 'active')
    .select('cart_id')
    .maybeSingle();
  if (updateError || !updatedCart) {
    const { error: cleanupError } = await supabase
      .from('checkout_sessions')
      .delete()
      .eq('id', session.id)
      .eq('merchant_id', merchant.id);
    logger.error({
      cleanupError: sanitizeForLog(cleanupError),
      error: sanitizeForLog(updateError),
      merchantId: merchant.id,
      message: 'Failed to link UCP cart to checkout session',
      route: CART_TO_CHECKOUT_ROUTE,
    });
    const migrated = await ucpCartMigrationRaceOutcome({
      error: updateError,
      cartId,
      merchantId: merchant.id,
      agentId: mutation.agentId,
      supabase,
    });
    if (migrated) return respond(migrated.body, migrated.status);
    return respond({ error: 'Database error' }, 500);
  }

  const status = mapCheckoutSessionStatus({
    hasFulfillmentAddress: !!shippingAddress,
    hasLineItems: sessionCalc.lineItems.length > 0,
    status: insertPayload.status,
  });

  return respond(
    buildCheckoutSessionStateResponse({
      currency: cartResult.cart.currency,
      fulfillmentOptionId,
      fulfillmentOptions: sessionCalc.fulfillmentOptions,
      lineItems: sessionCalc.lineItems,
      messages: sessionCalc.messages,
      policyBaseUrl: resolvePolicyBaseUrl({ merchant, requestUrl }),
      sessionId: session.session_id ?? sessionId,
      shippingAddress,
      status,
      totals: sessionCalc.totals,
    }),
    200
  );
}
