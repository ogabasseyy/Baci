import { type NextRequest, NextResponse } from 'next/server';
import { verifyAgenticRequestAccess } from '@/lib/agentic/agent-request-controls';
import { verifyAgenticApiKey } from '@/lib/agentic/auth';
import { calculateCheckoutSession } from '@/lib/agentic/checkout';
import { hasCheckoutPaymentSideEffect } from '@/lib/agentic/checkout-completion-response';
import {
  CHECKOUT_SESSION_MUTABLE_STATUSES,
  getAgenticCheckoutSession,
} from '@/lib/agentic/checkout-session-record';
import { buildCheckoutSessionStateResponse } from '@/lib/agentic/checkout-session-response';
import {
  buildCheckoutSessionUpdate,
  mapCheckoutSessionStatus,
} from '@/lib/agentic/checkout-storage';
import {
  AGENTIC_CHECKOUT_DISABLED_ERROR,
  isAgenticMerchantCheckoutEnabled,
  resolveAgenticMerchantContext,
} from '@/lib/agentic/merchant-context';
import { readAgenticMutationRequest } from '@/lib/agentic/mutation-request';
import { reserveAgenticRequestId } from '@/lib/agentic/request-replay';
import { getAgenticReplayErrorStatus } from '@/lib/agentic/request-replay-response';
import { createAgenticScopedSupabaseClient } from '@/lib/agentic/scoped-supabase';
import { logger } from '@/lib/logger';
import { sanitizeForLog } from '@/lib/sanitize-core';
import { buildStoreUrl } from '@/lib/store-url';
import { createAdminClient } from '@/lib/supabase/admin';
import { agenticCheckoutUpdateSchema } from '@/schemas/agentic-checkout';
import { agenticCheckoutSessionRouteParamsSchema } from '@/schemas/agentic-checkout-session-route-params';
import {
  CHECKOUT_SESSION_UPDATE_IDEMPOTENCY_ROUTE,
  reserveCheckoutSessionUpdateIdempotency,
} from './checkout-session-update-idempotency';

const UPDATE_IDEMPOTENCY_ROUTE = CHECKOUT_SESSION_UPDATE_IDEMPOTENCY_ROUTE;
type SessionRouteProps = { params: Promise<{ id: string }> };
type CheckoutSessionUpdateRouteOptions = {
  requestBodyAdapter?: (body: unknown) => unknown;
};

export async function handleAgenticCheckoutSessionUpdate(
  request: NextRequest,
  props: SessionRouteProps,
  options: CheckoutSessionUpdateRouteOptions = {}
) {
  const params = await props.params;
  if (!verifyAgenticApiKey(request))
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const parsedParams =
    agenticCheckoutSessionRouteParamsSchema.safeParse(params);
  if (!parsedParams.success) {
    return NextResponse.json(
      {
        error: 'Invalid route params',
        details: parsedParams.error.flatten(),
      },
      { status: 400 }
    );
  }
  const { id: sessionId } = parsedParams.data;

  const mutation = await readAgenticMutationRequest({ request });
  if (!mutation.ok) {
    return mutation.response;
  }
  let respondWithIdempotency:
    | ((response: unknown, status: number) => Promise<NextResponse>)
    | null = null;

  try {
    const requestBody =
      options.requestBodyAdapter?.(mutation.body) ?? mutation.body;
    const parsed = agenticCheckoutUpdateSchema.safeParse(requestBody);
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: 'Invalid request body',
          details: parsed.error.flatten(),
        },
        { status: 400 }
      );
    }
    const { items, shipping_address, fulfillment_option_id } = parsed.data;
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
    const idempotency = await reserveCheckoutSessionUpdateIdempotency({
      agentId: mutation.agentId,
      apiVersion: mutation.apiVersion,
      idempotencyKey: mutation.idempotencyKey,
      merchantId: merchant.id,
      method: mutation.method,
      pathname: mutation.pathname,
      rawBody: mutation.rawBody,
      requestId: mutation.requestId,
      supabase,
    });
    if (idempotency.kind !== 'reserved') {
      return idempotency.response;
    }
    respondWithIdempotency = idempotency.respond;
    if (!isAgenticMerchantCheckoutEnabled(merchant)) {
      logger.warn({
        message: AGENTIC_CHECKOUT_DISABLED_ERROR,
        merchantId: merchant.id,
        route: UPDATE_IDEMPOTENCY_ROUTE,
        sessionId,
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
      route: UPDATE_IDEMPOTENCY_ROUTE,
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
    const respond = (response: unknown, status: number) =>
      storeResponse(response, status);

    const { data: session, error } = await getAgenticCheckoutSession({
      merchantId: merchant.id,
      sessionId,
      supabase,
    });
    if (error) {
      logger.error({
        message: 'Failed to fetch checkout session',
        error: sanitizeForLog(error),
        sessionId,
      });
      return await respond({ error: 'Database error' }, 500);
    }
    if (!session) {
      return await respond({ error: 'Session not found' }, 404);
    }
    if (
      !(CHECKOUT_SESSION_MUTABLE_STATUSES as readonly string[]).includes(
        session.status
      )
    ) {
      return await respond(
        {
          error: 'Session cannot be updated',
          status: mapCheckoutSessionStatus({
            status: session.status,
            hasFulfillmentAddress: !!session.shipping_address,
            hasLineItems: session.cart_items.length > 0,
          }),
        },
        409
      );
    }
    if (hasCheckoutPaymentSideEffect(session)) {
      return await respond(
        {
          error: 'Session already has pending payment',
          status: 'payment_pending',
        },
        409
      );
    }
    const newItems = items ?? session.cart_items;
    const newAddress =
      shipping_address !== undefined
        ? shipping_address
        : session.shipping_address;
    const newOptionId =
      fulfillment_option_id !== undefined
        ? fulfillment_option_id
        : session.shipping_method;
    const sessionCalc = await calculateCheckoutSession(
      supabase,
      newItems,
      newOptionId,
      session.currency,
      merchant.id
    );
    const selectedOptionId =
      newOptionId ?? sessionCalc.selectedOptionId ?? null;
    const updatePayload = buildCheckoutSessionUpdate({
      items: newItems,
      currency: session.currency,
      fulfillmentAddress: newAddress ?? null,
      fulfillmentOptionId: selectedOptionId,
      lineItems: sessionCalc.lineItems,
      fulfillmentOptions: sessionCalc.fulfillmentOptions,
      totals: sessionCalc.totals,
      messages: sessionCalc.messages,
      existingMetadata: session.metadata,
    });
    const status = mapCheckoutSessionStatus({
      status: updatePayload.status,
      hasFulfillmentAddress: !!newAddress,
      hasLineItems: sessionCalc.lineItems.length > 0,
    });
    const { data: updatedSession, error: updateError } = await supabase
      .from('checkout_sessions')
      .update(updatePayload)
      .eq('session_id', sessionId)
      .eq('merchant_id', merchant.id)
      .is('order_id', null)
      .is('payment_reference', null)
      .is('virtual_account_number', null)
      .in('status', CHECKOUT_SESSION_MUTABLE_STATUSES)
      .select('session_id')
      .maybeSingle();
    if (updateError) {
      logger.error({
        message: 'Failed to update checkout session',
        error: sanitizeForLog(updateError),
        sessionId,
      });
      return await respond({ error: 'Database error' }, 500);
    }
    if (!updatedSession) {
      return await respond(
        {
          error: 'Session already has pending payment',
          status: 'payment_pending',
        },
        409
      );
    }
    const responsePayload = buildCheckoutSessionStateResponse({
      currency: session.currency,
      fulfillmentOptionId: selectedOptionId,
      fulfillmentOptions: sessionCalc.fulfillmentOptions,
      lineItems: sessionCalc.lineItems,
      messages: sessionCalc.messages,
      policyBaseUrl: buildStoreUrl(merchant),
      sessionId: session.session_id,
      shippingAddress: newAddress,
      status,
      totals: sessionCalc.totals,
    });
    return await respond(responsePayload, 200);
  } catch (err: unknown) {
    const body = { error: 'Internal Server Error' };
    logger.error({
      message: 'Agentic checkout update error',
      error: sanitizeForLog(err),
      sessionId,
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
