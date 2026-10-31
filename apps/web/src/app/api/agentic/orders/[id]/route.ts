import { after, type NextRequest, NextResponse } from 'next/server';
import { verifyAgenticRequestAccess } from '@/lib/agentic/agent-request-controls';
import { verifyAgenticApiKey } from '@/lib/agentic/auth';
import { resolveAgenticMerchantContextFromRpc } from '@/lib/agentic/merchant-context';
import { readAgenticQueryRequest } from '@/lib/agentic/mutation-request';
import { createAgenticScopedSupabaseClient } from '@/lib/agentic/scoped-supabase';
import {
  adaptOrderResponseToUcp,
  buildUcpOrderResponse,
} from '@/lib/agentic/ucp-response-adapters';
import { logger } from '@/lib/logger';
import { sanitizeForLog } from '@/lib/sanitize-core';
import { buildStoreUrl } from '@/lib/store-url';
import { agenticOrderRouteParamsSchema } from '@/schemas/agentic-order-route-params';

const AGENTIC_ORDER_SELECT =
  'id, order_number, payment_status, shipping_status, tracking_number, created_at, updated_at, subtotal, shipping_fee, discount_amount, tax_amount, total, currency, shipping_address, order_items(id, product_id, variant_id, name, price, quantity, line_extension_amount, vat_amount, fulfillment_data)';
const AGENTIC_ORDER_CHECKOUT_SESSION_SELECT = 'session_id';
const AGENTIC_ORDER_READ_ROUTE = 'orders.read';
const REQUEST_OUTCOME_RECORD_TTL_MS = 15 * 60 * 1000;

async function recordAgenticOrderReadOutcome({
  agentId,
  apiVersion,
  merchantId,
  requestId,
  statusCode,
  supabase,
}: {
  agentId: string | null;
  apiVersion: string;
  merchantId: string;
  requestId: string;
  statusCode: number;
  supabase: ReturnType<typeof createAgenticScopedSupabaseClient>;
}) {
  const now = new Date();

  try {
    const { error: purgeError } = await supabase
      .from('agentic_request_records')
      .delete()
      .eq('merchant_id', merchantId)
      .lt('expires_at', now.toISOString());

    if (purgeError) {
      logger.warn({
        message: 'Failed to purge expired agentic order read outcomes',
        error: sanitizeForLog(purgeError),
        merchantId,
      });
    }

    const { error } = await supabase.from('agentic_request_records').insert({
      agent_id: agentId,
      api_version: apiVersion,
      expires_at: new Date(
        now.getTime() + REQUEST_OUTCOME_RECORD_TTL_MS
      ).toISOString(),
      idempotency_key: null,
      merchant_id: merchantId,
      request_id: requestId,
      route: AGENTIC_ORDER_READ_ROUTE,
      status_code: statusCode,
    });

    if (error) {
      logger.warn({
        message: 'Failed to record agentic order read outcome',
        error: sanitizeForLog(error),
        merchantId,
        requestId,
      });
    }
  } catch (error) {
    logger.warn({
      message: 'Failed to record agentic order read outcome',
      error: sanitizeForLog(error),
      merchantId,
      requestId,
    });
  }
}

export async function GET(
  request: NextRequest,
  props: { params: Promise<{ id: string }> }
) {
  if (!verifyAgenticApiKey(request)) {
    return adaptOrderResponseToUcp(
      NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    );
  }

  const params = await props.params;
  const parsedParams = agenticOrderRouteParamsSchema.safeParse(params);
  if (!parsedParams.success) {
    return adaptOrderResponseToUcp(
      NextResponse.json(
        {
          error: 'Invalid route params',
          details: parsedParams.error.flatten(),
        },
        { status: 400 }
      )
    );
  }

  const signedRead = await readAgenticQueryRequest({
    request,
  });
  if (!signedRead.ok) {
    return adaptOrderResponseToUcp(signedRead.response);
  }

  const merchant = await resolveAgenticMerchantContextFromRpc();
  if (!merchant) {
    return adaptOrderResponseToUcp(
      NextResponse.json(
        { error: 'Agentic merchant not found' },
        { status: 500 }
      )
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
    return adaptOrderResponseToUcp(
      NextResponse.json({ error: agentAccess.error }, { status: 403 })
    );
  }

  const supabase = createAgenticScopedSupabaseClient({
    merchantId: merchant.id,
    merchantSlug: merchant.slug,
  });
  const respondWithOutcome = async (
    response: Response | Promise<Response>
  ): Promise<Response> => {
    const resolvedResponse = await response;
    after(() =>
      recordAgenticOrderReadOutcome({
        agentId: signedRead.agentId ?? null,
        apiVersion: signedRead.apiVersion,
        merchantId: merchant.id,
        requestId: signedRead.requestId,
        statusCode: resolvedResponse.status,
        supabase,
      })
    );
    return resolvedResponse;
  };

  const { data: order, error } = await supabase
    .from('orders')
    .select(AGENTIC_ORDER_SELECT)
    .eq('id', parsedParams.data.id)
    .eq('merchant_id', merchant.id)
    .eq('source', 'agentic_ai')
    .maybeSingle();

  if (error) {
    logger.error({
      message: 'Failed to fetch agentic order',
      error: sanitizeForLog(error),
      merchantId: merchant.id,
      orderId: parsedParams.data.id,
    });
    return respondWithOutcome(
      adaptOrderResponseToUcp(
        NextResponse.json({ error: 'Failed to fetch order' }, { status: 500 })
      )
    );
  }

  if (!order) {
    return respondWithOutcome(
      adaptOrderResponseToUcp(
        NextResponse.json({ error: 'Order not found' }, { status: 404 })
      )
    );
  }

  const { data: checkoutSession, error: checkoutSessionError } = await supabase
    .from('checkout_sessions')
    .select(AGENTIC_ORDER_CHECKOUT_SESSION_SELECT)
    .eq('order_id', order.id)
    .eq('merchant_id', merchant.id)
    .maybeSingle();

  if (checkoutSessionError) {
    logger.error({
      message: 'Failed to fetch agentic order checkout session',
      error: sanitizeForLog(checkoutSessionError),
      merchantId: merchant.id,
      orderId: parsedParams.data.id,
    });
    return respondWithOutcome(
      adaptOrderResponseToUcp(
        NextResponse.json(
          { error: 'Failed to fetch order checkout session' },
          { status: 500 }
        )
      )
    );
  }

  const storeUrl = buildStoreUrl(merchant);

  return respondWithOutcome(
    NextResponse.json(
      buildUcpOrderResponse({
        checkout_id: checkoutSession?.session_id ?? null,
        id: order.id,
        order_number: order.order_number,
        payment_status: order.payment_status,
        shipping_status: order.shipping_status,
        tracking_number: order.tracking_number,
        created_at: order.created_at,
        updated_at: order.updated_at,
        subtotal: order.subtotal,
        shipping_fee: order.shipping_fee,
        discount_amount: order.discount_amount,
        tax_amount: order.tax_amount,
        total: order.total,
        currency: order.currency,
        shipping_address: order.shipping_address,
        order_items: order.order_items,
        links: {
          track_order: `${storeUrl}/track-order`,
          support: `${storeUrl}/contact`,
        },
      })
    )
  );
}
