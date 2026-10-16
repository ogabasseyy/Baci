import { type NextRequest, NextResponse } from 'next/server';
import { verifyAgenticApiKey } from '@/lib/agentic/auth';
import { calculateCheckoutSession } from '@/lib/agentic/checkout';
import { reserveAgenticIdempotencyKey } from '@/lib/agentic/idempotency';
import { getAgenticIdempotencyErrorStatus } from '@/lib/agentic/idempotency-response';
import { buildStoredAgenticIdempotencyResponse } from '@/lib/agentic/idempotency-response-storage';
import {
  readAgenticMutationRequest,
  readAgenticQueryRequest,
} from '@/lib/agentic/mutation-request';
import { reserveAgenticRequestId } from '@/lib/agentic/request-replay';
import { getAgenticReplayErrorStatus } from '@/lib/agentic/request-replay-response';
import { handleCanonicalUcpCart } from '@/lib/agentic/ucp-canonical-cart';
import {
  toCanonicalLaneLine,
  toCheckoutLaneItem,
} from '@/lib/agentic/ucp-cart-lane-items';
import { ucpCartMigrationRaceOutcome } from '@/lib/agentic/ucp-cart-migration-race';
import { readUcpCart } from '@/lib/agentic/ucp-cart-read-route';
import { buildUcpCartResponse } from '@/lib/agentic/ucp-cart-response';
import {
  buildUcpCartContinueUrl,
  buildUcpCartStateResponse,
  loadUcpCartSession,
  resolveUcpCartContext,
} from '@/lib/agentic/ucp-cart-route-support';
import {
  buildUcpCartUpdate,
  coerceJsonRecord,
  coerceNullableJsonRecord,
  coerceUcpCartItems,
  migratedCartRefreshOutcome,
  ucpCartCallerMismatch,
} from '@/lib/agentic/ucp-cart-storage';
import { adaptUcpShippingAddressToAgentic } from '@/lib/agentic/ucp-request-adapters';
import {
  planUcpCartReplacement,
  ucpCartVersionPrecondition,
} from '@/lib/cart/ucp-adapter';
import { logger } from '@/lib/logger';
import { ucpCartUpdateRequestSchema } from '@/schemas/ucp-cart-request';
import { ucpCartRouteParamsSchema } from '@/schemas/ucp-cart-route-params';

const UPDATE_CART_ROUTE = 'carts.update';
type RouteProps = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, props: RouteProps) {
  if (!verifyAgenticApiKey(request))
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const parsedParams = ucpCartRouteParamsSchema.safeParse(await props.params);
  if (!parsedParams.success)
    return NextResponse.json(
      { error: 'Invalid route params' },
      { status: 400 }
    );
  const query = await readAgenticQueryRequest({ request });
  if (!query.ok) return query.response;
  const context = await resolveUcpCartContext(request);
  if (!context.ok) return context.response;
  return readUcpCart(
    {
      request,
      cartId: parsedParams.data.id,
      agentId: query.agentId,
      ...context,
    },
    {
      canonical: handleCanonicalUcpCart,
      load: loadUcpCartSession,
      respond: buildUcpCartStateResponse,
    }
  );
}

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

  const parsed = ucpCartUpdateRequestSchema.safeParse(mutation.body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid request body' },
      { status: 400 }
    );
  }

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
    route: UPDATE_CART_ROUTE,
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
      route: UPDATE_CART_ROUTE,
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
    route: UPDATE_CART_ROUTE,
    supabase: context.supabase,
  });
  if (!replayReservation.ok) {
    return respond(
      { error: replayReservation.error },
      getAgenticReplayErrorStatus(replayReservation.error)
    );
  }

  const canonical = await handleCanonicalUcpCart({
    merchant: context.merchant,
    cartId: parsedParams.data.id,
    agentId: mutation.agentId,
    action: 'update',
    detailsRequireHandoff:
      parsed.data.buyer !== undefined ||
      parsed.data.shipping_address !== undefined ||
      parsed.data.currency !== undefined,
    operationId: mutation.idempotencyKey,
    expectedVersion: parsed.data.expectedVersion,
    lines: parsed.data.line_items?.map((line) => ({
      item: {
        productId: line.item.id,
        ...(line.item.variant_id ? { variantId: line.item.variant_id } : {}),
        ...(line.item.condition ? { condition: line.item.condition } : {}),
        ...(line.item.variant_attributes
          ? { options: line.item.variant_attributes }
          : {}),
      },
      quantity: line.quantity,
    })),
  });
  if (canonical) return respond(canonical.body, canonical.status);

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
  if (cartResult.cart.status !== 'active') {
    return respond({ error: 'Cart cannot be updated' }, 409);
  }

  const existingItems = coerceUcpCartItems(cartResult.cart.cart_items);
  const items =
    parsed.data.line_items?.map(toCheckoutLaneItem) ?? existingItems;
  // Replacement intent is planned through the canonical cart contract;
  // the loaded row's committed timestamp is the concurrency precondition.
  const replacement = planUcpCartReplacement({
    lines: items.map(toCanonicalLaneLine),
    updatedAt: ucpCartVersionPrecondition(cartResult.cart),
  });
  if (!replacement.ok) {
    return respond(
      { code: replacement.code, error: 'Invalid cart items' },
      400
    );
  }
  const currency = parsed.data.currency ?? cartResult.cart.currency;
  const shippingAddress =
    parsed.data.shipping_address !== undefined
      ? adaptUcpShippingAddressToAgentic(parsed.data.shipping_address)
      : coerceNullableJsonRecord(cartResult.cart.shipping_address);
  const calculation = await calculateCheckoutSession(
    context.supabase,
    items,
    null,
    currency,
    context.merchant.id
  );
  if (calculation.lineItems.length === 0) {
    return respond({ error: 'No valid cart items' }, 400);
  }

  const updatePayload = buildUcpCartUpdate({
    buyer: parsed.data.buyer,
    existingBuyer: coerceJsonRecord(cartResult.cart.buyer),
    items,
    shippingAddress,
  });
  let updateQuery = context.supabase
    .from('agentic_cart_sessions')
    .update({ ...updatePayload, currency: currency.toUpperCase() })
    .eq('cart_id', parsedParams.data.id)
    .eq('merchant_id', context.merchant.id)
    .eq('status', 'active');
  // Optimistic concurrency: a replacement committed after our load wins;
  // this stale replacement must not overwrite it.
  if (replacement.precondition) {
    updateQuery = updateQuery.eq('updated_at', replacement.precondition);
  }
  const { data: updatedCart, error: updateError } = await updateQuery
    .select('cart_id')
    .maybeSingle();
  if (updateError) {
    const migrated = await ucpCartMigrationRaceOutcome({
      error: updateError,
      cartId: parsedParams.data.id,
      merchantId: context.merchant.id,
      agentId: mutation.agentId,
      supabase: context.supabase,
    });
    if (migrated) return respond(migrated.body, migrated.status);
    return respond({ error: 'Database error' }, 500);
  }
  if (!updatedCart) {
    logger.warn({
      cartId: parsedParams.data.id,
      merchantId: context.merchant.id,
      message: 'UCP cart replacement lost a version race',
      route: UPDATE_CART_ROUTE,
    });
    return respond(
      {
        code: 'version_conflict',
        error: 'Cart changed; refresh to continue',
      },
      409
    );
  }

  return respond(
    buildUcpCartResponse({
      cartId: parsedParams.data.id,
      continueUrl: buildUcpCartContinueUrl({
        cartId: parsedParams.data.id,
        merchant: context.merchant,
        request,
      }),
      currency,
      lineItems: calculation.lineItems,
      status: 'active',
      totals: calculation.totals,
    }),
    200
  );
}
