import { type NextRequest, NextResponse } from 'next/server';
import { verifyAgenticApiKey } from '@/lib/agentic/auth';
import { calculateCheckoutSession } from '@/lib/agentic/checkout';
import { reserveAgenticIdempotencyKey } from '@/lib/agentic/idempotency';
import { getAgenticIdempotencyErrorStatus } from '@/lib/agentic/idempotency-response';
import { buildStoredAgenticIdempotencyResponse } from '@/lib/agentic/idempotency-response-storage';
import { readAgenticMutationRequest } from '@/lib/agentic/mutation-request';
import { reserveAgenticRequestId } from '@/lib/agentic/request-replay';
import { getAgenticReplayErrorStatus } from '@/lib/agentic/request-replay-response';
import { buildUcpCartResponse } from '@/lib/agentic/ucp-cart-response';
import {
  buildUcpCartContinueUrl,
  loadUcpCartSession,
  resolveUcpCartContext,
} from '@/lib/agentic/ucp-cart-route-support';
import {
  buildUcpCartStatusUpdate,
  coerceUcpCartItems,
  migratedCartRefreshOutcome,
  ucpCartCallerMismatch,
} from '@/lib/agentic/ucp-cart-storage';
import { ucpCartRouteParamsSchema } from '@/schemas/ucp-cart-route-params';

const CANCEL_CART_ROUTE = 'carts.cancel';
type RouteProps = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, props: RouteProps) {
  if (!verifyAgenticApiKey(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const parsedParams = ucpCartRouteParamsSchema.safeParse(await props.params);
  if (!parsedParams.success) {
    return NextResponse.json(
      { error: 'Invalid route params' },
      { status: 400 }
    );
  }

  const mutation = await readAgenticMutationRequest({ request });
  if (!mutation.ok) return mutation.response;

  const context = await resolveUcpCartContext(request);
  if (!context.ok) return context.response;

  const idempotency = await reserveAgenticIdempotencyKey({
    agentId: mutation.agentId,
    apiVersion: mutation.apiVersion,
    body: mutation.rawBody,
    key: mutation.idempotencyKey,
    merchantId: context.merchant.id,
    method: mutation.method,
    pathname: mutation.pathname,
    route: CANCEL_CART_ROUTE,
    supabase: context.supabase,
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
      merchantId: context.merchant.id,
      requestId: mutation.requestId,
      response,
      route: CANCEL_CART_ROUTE,
      status,
      storageFailureResponse: { error: 'Idempotency response storage failed' },
      supabase: context.supabase,
    });

  const replayReservation = await reserveAgenticRequestId({
    agentId: mutation.agentId,
    apiVersion: mutation.apiVersion,
    idempotencyKey: mutation.idempotencyKey,
    merchantId: context.merchant.id,
    requestId: mutation.requestId,
    route: CANCEL_CART_ROUTE,
    supabase: context.supabase,
  });
  if (!replayReservation.ok) {
    return respond(
      { error: replayReservation.error },
      getAgenticReplayErrorStatus(replayReservation.error)
    );
  }

  const cartResult = await loadUcpCartSession({
    cartId: parsedParams.data.id,
    merchantId: context.merchant.id,
    supabase: context.supabase,
  });
  if (cartResult.error) return respond({ error: 'Database error' }, 500);
  if (!cartResult.cart) return respond({ error: 'Cart not found' }, 404);
  if (
    ucpCartCallerMismatch(cartResult.cart, mutation.agentId, { mutation: true })
  ) {
    return respond({ error: 'Cart not found' }, 404);
  }
  const migratedOutcome = migratedCartRefreshOutcome(cartResult.cart);
  if (migratedOutcome) {
    return respond(migratedOutcome.body, migratedOutcome.status);
  }
  if (cartResult.cart.status === 'converted') {
    return respond({ error: 'Converted cart cannot be canceled' }, 409);
  }

  if (cartResult.cart.status === 'active') {
    const { data: updatedCart, error: updateError } = await context.supabase
      .from('agentic_cart_sessions')
      .update(buildUcpCartStatusUpdate('canceled'))
      .eq('cart_id', parsedParams.data.id)
      .eq('merchant_id', context.merchant.id)
      .eq('status', 'active')
      .select('cart_id')
      .maybeSingle();
    if (updateError) return respond({ error: 'Database error' }, 500);
    if (!updatedCart) return respond({ error: 'Cart cannot be canceled' }, 409);
  }

  const calculation = await calculateCheckoutSession(
    context.supabase,
    coerceUcpCartItems(cartResult.cart.cart_items),
    null,
    cartResult.cart.currency,
    context.merchant.id
  );

  return respond(
    buildUcpCartResponse({
      cartId: parsedParams.data.id,
      continueUrl: buildUcpCartContinueUrl({
        cartId: parsedParams.data.id,
        merchant: context.merchant,
        request,
      }),
      currency: cartResult.cart.currency,
      lineItems: calculation.lineItems,
      status: cartResult.cart.status === 'expired' ? 'expired' : 'canceled',
      totals: calculation.totals,
    }),
    200
  );
}
