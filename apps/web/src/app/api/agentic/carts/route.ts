import { randomUUID } from 'node:crypto';
import { type NextRequest, NextResponse } from 'next/server';
import { verifyAgenticRequestAccess } from '@/lib/agentic/agent-request-controls';
import { verifyAgenticApiKey } from '@/lib/agentic/auth';
import { calculateCheckoutSession } from '@/lib/agentic/checkout';
import { reserveAgenticIdempotencyKey } from '@/lib/agentic/idempotency';
import { getAgenticIdempotencyErrorStatus } from '@/lib/agentic/idempotency-response';
import { buildStoredAgenticIdempotencyResponse } from '@/lib/agentic/idempotency-response-storage';
import { resolveAgenticMerchantContext } from '@/lib/agentic/merchant-context';
import { readAgenticMutationRequest } from '@/lib/agentic/mutation-request';
import { reserveAgenticRequestId } from '@/lib/agentic/request-replay';
import { getAgenticReplayErrorStatus } from '@/lib/agentic/request-replay-response';
import { createAgenticScopedSupabaseClient } from '@/lib/agentic/scoped-supabase';
import { handleCanonicalUcpCart } from '@/lib/agentic/ucp-canonical-cart';
import { buildUcpCartResponse } from '@/lib/agentic/ucp-cart-response';
import { buildUcpCartInsert } from '@/lib/agentic/ucp-cart-storage';
import { adaptUcpShippingAddressToAgentic } from '@/lib/agentic/ucp-request-adapters';
import { logger } from '@/lib/logger';
import { sanitizeForLog } from '@/lib/sanitize-core';
import { buildRequestScopedStoreUrl } from '@/lib/store-url';
import { createAdminClient } from '@/lib/supabase/admin';
import { ucpCartCreateRequestSchema } from '@/schemas/ucp-cart-request';

const CREATE_CART_ROUTE = 'carts.create';

export async function POST(request: NextRequest) {
  if (!verifyAgenticApiKey(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const mutation = await readAgenticMutationRequest({ request });
  if (!mutation.ok) {
    return mutation.response;
  }

  const parsed = ucpCartCreateRequestSchema.safeParse(mutation.body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid request body' },
      { status: 400 }
    );
  }

  const merchant = await resolveAgenticMerchantContext(createAdminClient());
  if (!merchant) {
    return NextResponse.json(
      { error: 'Agentic merchant not found' },
      { status: 500 }
    );
  }

  const agentAccess = verifyAgenticRequestAccess({
    controls: {
      allowlist: merchant.agent_user_agent_allowlist ?? [],
      denylist: merchant.agent_user_agent_denylist ?? [],
    },
    headers: request.headers,
  });
  if (!agentAccess.ok) {
    return NextResponse.json({ error: agentAccess.error }, { status: 403 });
  }

  const supabase = createAgenticScopedSupabaseClient({
    merchantId: merchant.id,
    merchantSlug: merchant.slug,
  });
  const idempotency = await reserveAgenticIdempotencyKey({
    agentId: mutation.agentId,
    apiVersion: mutation.apiVersion,
    body: mutation.rawBody,
    key: mutation.idempotencyKey,
    merchantId: merchant.id,
    method: mutation.method,
    pathname: mutation.pathname,
    route: CREATE_CART_ROUTE,
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
      route: CREATE_CART_ROUTE,
      status,
      storageFailureResponse: { error: 'Idempotency response storage failed' },
      supabase,
    });

  // Cart transfer is independent of native checkout readiness: creating
  // a transfer cart never implies checkout/payment availability, which
  // the checkout conversion path continues to gate separately.

  const replayReservation = await reserveAgenticRequestId({
    agentId: mutation.agentId,
    apiVersion: mutation.apiVersion,
    idempotencyKey: mutation.idempotencyKey,
    merchantId: merchant.id,
    requestId: mutation.requestId,
    route: CREATE_CART_ROUTE,
    supabase,
  });
  if (!replayReservation.ok) {
    return respond(
      { error: replayReservation.error },
      getAgenticReplayErrorStatus(replayReservation.error)
    );
  }

  const items = parsed.data.line_items.map((lineItem) => ({
    id: lineItem.item.id,
    quantity: lineItem.quantity,
  }));
  const currency = parsed.data.currency;
  let calculation: Awaited<ReturnType<typeof calculateCheckoutSession>>;
  try {
    calculation = await calculateCheckoutSession(
      supabase,
      items,
      null,
      currency,
      merchant.id
    );
  } catch (error) {
    logger.error({
      error: sanitizeForLog(error),
      merchantId: merchant.id,
      message: 'UCP cart calculation failed',
      route: CREATE_CART_ROUTE,
    });
    return respond({ error: 'Cart calculation failed' }, 500);
  }

  if (calculation.lineItems.length === 0) {
    return respond({ error: 'No valid cart items' }, 400);
  }

  const cartId = `cart_${randomUUID().replaceAll('-', '')}`;
  const shippingAddress = adaptUcpShippingAddressToAgentic(
    parsed.data.shipping_address
  );
  const normalizedItems = calculation.lineItems.map((lineItem) => ({
    id: lineItem.item.id,
    quantity: lineItem.item.quantity,
  }));
  const { error } = await supabase.from('agentic_cart_sessions').insert(
    buildUcpCartInsert({
      agentId: mutation.agentId,
      buyer: parsed.data.buyer ?? {},
      cartId,
      currency,
      items: normalizedItems,
      merchantId: merchant.id,
      metadata: { source: 'ucp' },
      shippingAddress,
    })
  );
  if (error) {
    logger.error({
      error: sanitizeForLog(error),
      merchantId: merchant.id,
      message: 'Failed to create UCP cart',
      route: CREATE_CART_ROUTE,
    });
    return respond({ error: 'Failed to create cart' }, 500);
  }

  const canonical = await handleCanonicalUcpCart({
    merchant,
    cartId,
    agentId: mutation.agentId,
    action: 'read',
    operationId: mutation.idempotencyKey,
  });
  if (canonical)
    return respond(
      // The legacy insert already committed. Keep its durable owner handle
      // in cached failures so a follow-up GET can recover migrated authority.
      canonical.status >= 400
        ? { ...canonical.body, cart_id: cartId }
        : canonical.body,
      canonical.status === 200 ? 201 : canonical.status
    );

  return respond(
    buildUcpCartResponse({
      cartId,
      continueUrl: buildCartContinueUrl({
        cartId,
        merchant,
        request,
      }),
      currency,
      lineItems: calculation.lineItems,
      status: 'active',
      totals: calculation.totals,
    }),
    201
  );
}

function buildCartContinueUrl({
  cartId,
  merchant,
  request,
}: {
  cartId: string;
  merchant: Parameters<typeof buildRequestScopedStoreUrl>[0];
  request: NextRequest;
}) {
  const baseUrl = buildRequestScopedStoreUrl(merchant, request.headers);
  return `${baseUrl}/cart?agentic_cart_id=${encodeURIComponent(cartId)}`;
}
