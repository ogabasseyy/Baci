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
import { mapCheckoutSessionStatus } from '@/lib/agentic/checkout-storage';
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
import { logger } from '@/lib/logger';
import { sanitizeForLog } from '@/lib/sanitize-core';
import { buildStoreUrl } from '@/lib/store-url';
import { createAdminClient } from '@/lib/supabase/admin';
import { agenticCheckoutItemsSchema } from '@/schemas/agentic-checkout';
import { agenticCheckoutSessionRouteParamsSchema } from '@/schemas/agentic-checkout-session-route-params';

const CANCEL_IDEMPOTENCY_ROUTE = 'checkout_sessions.cancel';

export async function POST(
  request: NextRequest,
  props: { params: Promise<{ id: string }> }
) {
  const params = await props.params; // Next.js 15+ await params
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
    const idempotency = await reserveAgenticIdempotencyKey({
      agentId: mutation.agentId,
      apiVersion: mutation.apiVersion,
      body: mutation.rawBody,
      key: mutation.idempotencyKey,
      merchantId: merchant.id,
      method: mutation.method,
      pathname: mutation.pathname,
      route: CANCEL_IDEMPOTENCY_ROUTE,
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
    respondWithIdempotency = (response: unknown, status: number) =>
      buildStoredAgenticIdempotencyResponse({
        agentId: mutation.agentId,
        idempotencyKey: mutation.idempotencyKey,
        merchantId: merchant.id,
        requestId: mutation.requestId,
        response,
        route: CANCEL_IDEMPOTENCY_ROUTE,
        status,
        supabase,
      });
    if (!isAgenticMerchantCheckoutEnabled(merchant)) {
      logger.warn({
        message: AGENTIC_CHECKOUT_DISABLED_ERROR,
        merchantId: merchant.id,
        route: CANCEL_IDEMPOTENCY_ROUTE,
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
      route: CANCEL_IDEMPOTENCY_ROUTE,
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

    // Check if exists
    const { data: session, error: fetchError } =
      await getAgenticCheckoutSession({
        merchantId: merchant.id,
        sessionId,
        supabase,
      });

    if (fetchError) {
      logger.error({
        message: 'Failed to fetch checkout session',
        error: sanitizeForLog(fetchError),
        sessionId,
      });
      return await respond({ error: 'Database error' }, 500);
    }
    if (!session) return await respond({ error: 'Session not found' }, 404);
    if (session.status === 'completed')
      return await respond({ error: 'Cannot cancel completed session' }, 409);
    if (
      !(CHECKOUT_SESSION_MUTABLE_STATUSES as readonly string[]).includes(
        session.status
      )
    )
      return await respond({ error: 'Session cannot be canceled' }, 409);
    if (hasCheckoutPaymentSideEffect(session))
      return await respond(
        {
          error: 'Session already has pending payment',
          status: 'payment_pending',
        },
        409
      );

    // Update status
    const { data: updatedSession, error: updateError } = await supabase
      .from('checkout_sessions')
      .update({ status: 'abandoned' })
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
        message: 'Failed to cancel checkout session',
        error: sanitizeForLog(updateError),
        sessionId,
      });
      return await respond({ error: 'Database error' }, 500);
    }
    if (!updatedSession) {
      return await respond(
        {
          error: 'Session was modified concurrently',
          status: 'concurrent_modification',
        },
        409
      );
    }

    const parsedCartItems = agenticCheckoutItemsSchema.safeParse(
      session.cart_items
    );
    let sessionCalc: Awaited<ReturnType<typeof calculateCheckoutSession>> = {
      fulfillmentOptions: [],
      lineItems: [],
      messages: [],
      selectedOptionId: session.shipping_method ?? undefined,
      totals: [],
    };
    if (parsedCartItems.success) {
      try {
        sessionCalc = await calculateCheckoutSession(
          supabase,
          parsedCartItems.data,
          session.shipping_method,
          session.currency,
          merchant.id
        );
      } catch (error) {
        logger.warn({
          message: 'Canceled checkout session response calculation failed',
          error: sanitizeForLog(error),
          sessionId,
        });
      }
    } else {
      logger.warn({
        message: 'Canceled checkout session has invalid cart items',
        error: sanitizeForLog(parsedCartItems.error.flatten()),
        sessionId,
      });
    }

    const responsePayload = buildCheckoutSessionStateResponse({
      status: mapCheckoutSessionStatus({
        status: 'abandoned',
        hasFulfillmentAddress: !!session.shipping_address,
        hasLineItems: sessionCalc.lineItems.length > 0,
      }),
      currency: session.currency,
      fulfillmentOptionId: session.shipping_method,
      fulfillmentOptions: sessionCalc.fulfillmentOptions,
      lineItems: sessionCalc.lineItems,
      messages: sessionCalc.messages,
      policyBaseUrl: buildStoreUrl(merchant),
      sessionId: session.session_id,
      shippingAddress: session.shipping_address,
      totals: sessionCalc.totals,
    });

    return await respond(responsePayload, 200);
  } catch (err: unknown) {
    const body = { error: 'Internal Server Error' };
    logger.error({
      message: 'Agentic checkout cancel error',
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
