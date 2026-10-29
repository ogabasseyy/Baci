import { randomUUID } from 'node:crypto';
import { type NextRequest, NextResponse } from 'next/server';
import { verifyAgenticRequestAccess } from '@/lib/agentic/agent-request-controls';
import { verifyAgenticApiKey } from '@/lib/agentic/auth';
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
  isAgenticMerchantCheckoutEnabled,
  resolveAgenticMerchantContext,
} from '@/lib/agentic/merchant-context';
import { readAgenticMutationRequest } from '@/lib/agentic/mutation-request';
import { reserveAgenticRequestId } from '@/lib/agentic/request-replay';
import { getAgenticReplayErrorStatus } from '@/lib/agentic/request-replay-response';
import { createAgenticScopedSupabaseClient } from '@/lib/agentic/scoped-supabase';
import { convertUcpCartToCheckout } from '@/lib/agentic/ucp-cart-checkout-conversion';
import { logger } from '@/lib/logger';
import { sanitizeForLog } from '@/lib/sanitize-core';
import { buildStoreUrl } from '@/lib/store-url';
import { createAdminClient } from '@/lib/supabase/admin';
import { checkoutSessionSchema } from '@/schemas/agentic-checkout';

const CREATE_IDEMPOTENCY_ROUTE = 'checkout_sessions.create';
type CheckoutSessionCreateRouteOptions = {
  requestBodyAdapter?: (body: unknown) => unknown;
};

export async function handleAgenticCheckoutSessionCreate(
  request: NextRequest,
  options: CheckoutSessionCreateRouteOptions = {}
) {
  if (!verifyAgenticApiKey(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const mutation = await readAgenticMutationRequest({ request });
  if (!mutation.ok) {
    return mutation.response;
  }

  let respondWithIdempotency:
    | ((
        response: unknown,
        status: number,
        storageFailureResponse?: Record<string, unknown>
      ) => Promise<NextResponse>)
    | null = null;

  try {
    const requestBody =
      options.requestBodyAdapter?.(mutation.body) ?? mutation.body;
    const parsed = checkoutSessionSchema.safeParse(requestBody);
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: 'Invalid request body',
          details: parsed.error.flatten(),
        },
        { status: 400 }
      );
    }
    // 2. Calculate Cart State
    const bootstrap = createAdminClient();
    const merchant = await resolveAgenticMerchantContext(bootstrap);

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

    if ('cart_id' in parsed.data) {
      return await convertUcpCartToCheckout({
        cartId: parsed.data.cart_id,
        merchant,
        mutation,
        requestUrl: request.url,
        supabase,
      });
    }

    const { items, shipping_address, currency } = parsed.data;
    const checkoutCurrency = currency ?? 'NGN';
    const idempotency = await reserveAgenticIdempotencyKey({
      agentId: mutation.agentId,
      apiVersion: mutation.apiVersion,
      body: mutation.rawBody,
      key: mutation.idempotencyKey,
      merchantId: merchant.id,
      method: mutation.method,
      pathname: mutation.pathname,
      route: CREATE_IDEMPOTENCY_ROUTE,
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
        status: idempotency.status,
        headers: {
          'idempotency-key': mutation.idempotencyKey,
          'request-id': mutation.requestId,
        },
      });
    }
    respondWithIdempotency = (
      response: unknown,
      status: number,
      storageFailureResponse?: Record<string, unknown>
    ): Promise<NextResponse> =>
      buildStoredAgenticIdempotencyResponse({
        agentId: mutation.agentId,
        idempotencyKey: mutation.idempotencyKey,
        merchantId: merchant.id,
        requestId: mutation.requestId,
        response,
        route: CREATE_IDEMPOTENCY_ROUTE,
        status,
        storageFailureResponse,
        supabase,
      });
    if (!isAgenticMerchantCheckoutEnabled(merchant)) {
      logger.warn({
        message: AGENTIC_CHECKOUT_DISABLED_ERROR,
        merchantId: merchant.id,
        route: CREATE_IDEMPOTENCY_ROUTE,
      });
      return await respondWithIdempotency(
        { error: AGENTIC_CHECKOUT_DISABLED_ERROR },
        403
      );
    }
    const replayReservation = await reserveAgenticRequestId({
      agentId: mutation.agentId,
      apiVersion: mutation.apiVersion,
      idempotencyKey: mutation.idempotencyKey,
      merchantId: merchant.id,
      requestId: mutation.requestId,
      route: CREATE_IDEMPOTENCY_ROUTE,
      supabase,
    });
    if (!replayReservation.ok) {
      return await respondWithIdempotency(
        { error: replayReservation.error },
        getAgenticReplayErrorStatus(replayReservation.error)
      );
    }

    const storeResponse = respondWithIdempotency;
    if (!storeResponse) {
      return NextResponse.json(
        { error: 'Internal Server Error' },
        { status: 500 }
      );
    }
    const respond = (
      response: unknown,
      status: number,
      storageFailureResponse?: Record<string, unknown>
    ): Promise<NextResponse> =>
      storeResponse(response, status, storageFailureResponse);

    let sessionCalc: Awaited<ReturnType<typeof calculateCheckoutSession>>;
    try {
      sessionCalc = await calculateCheckoutSession(
        supabase,
        items,
        null,
        checkoutCurrency,
        merchant.id
      );
    } catch (error) {
      logger.error({
        message: 'Agentic checkout session calculation failed',
        error,
        idempotencyKey: mutation.idempotencyKey,
        merchantId: merchant.id,
      });
      return await respond({ error: 'Checkout calculation failed' }, 500);
    }

    if (sessionCalc.lineItems.length === 0) {
      return await respond(
        {
          error: 'No valid checkout items',
          messages: sessionCalc.messages,
        },
        400
      );
    }

    // 3. Create Session in DB
    const sessionId = `agentic_${randomUUID()}`;
    const fulfillmentOptionId = sessionCalc.selectedOptionId ?? null;
    const insertPayload = buildCheckoutSessionInsert({
      sessionId,
      merchantId: merchant.id,
      items,
      currency: checkoutCurrency,
      fulfillmentAddress: shipping_address ?? null,
      fulfillmentOptionId,
      lineItems: sessionCalc.lineItems,
      fulfillmentOptions: sessionCalc.fulfillmentOptions,
      totals: sessionCalc.totals,
      messages: sessionCalc.messages,
    });

    const { data: session, error } = await supabase
      .from('checkout_sessions')
      .insert(insertPayload)
      .select('id, session_id')
      .single();

    if (error) {
      logger.error({
        message: 'Failed to create agentic checkout session',
        error,
        idempotencyKey: mutation.idempotencyKey,
        merchantId: merchant.id,
      });
      return await respond({ error: 'Database error' }, 500);
    }

    // 4. Response
    const status = mapCheckoutSessionStatus({
      status: insertPayload.status,
      hasFulfillmentAddress: !!shipping_address,
      hasLineItems: sessionCalc.lineItems.length > 0,
    });
    const responseSessionId = session.session_id ?? sessionId;
    const responsePayload = buildCheckoutSessionStateResponse({
      currency: checkoutCurrency,
      fulfillmentOptionId,
      fulfillmentOptions: sessionCalc.fulfillmentOptions,
      lineItems: sessionCalc.lineItems,
      messages: sessionCalc.messages,
      policyBaseUrl: buildStoreUrl(merchant),
      sessionId: responseSessionId,
      shippingAddress: shipping_address ?? null,
      status,
      totals: sessionCalc.totals,
    });

    return await respond(responsePayload, 201, {
      error: 'Idempotency response storage failed',
      idempotency_key: mutation.idempotencyKey,
      recovery_action: 'read_checkout_session',
      session_id: responseSessionId,
    });
  } catch (err) {
    const body = { error: 'Internal Server Error' };
    logger.error({
      message: 'Agentic checkout session create error',
      error: sanitizeForLog(err),
      idempotencyKey: mutation.idempotencyKey,
      requestId: mutation.requestId,
    });
    if (respondWithIdempotency) {
      try {
        return await respondWithIdempotency(body, 500);
      } catch {
        return NextResponse.json(body, { status: 500 });
      }
    }
    return NextResponse.json(body, { status: 500 });
  }
}
