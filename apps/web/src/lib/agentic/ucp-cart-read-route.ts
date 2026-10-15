import { type NextRequest, NextResponse } from 'next/server';
import { verifyAgenticApiKey } from '@/lib/agentic/auth';
import { readAgenticQueryRequest } from '@/lib/agentic/mutation-request';
import { handleCanonicalUcpCart } from '@/lib/agentic/ucp-canonical-cart';
import {
  buildUcpCartStateResponse,
  loadUcpCartSession,
  resolveUcpCartContext,
} from '@/lib/agentic/ucp-cart-route-support';
import { ucpCartCallerMismatch } from '@/lib/agentic/ucp-cart-storage';
import { logger } from '@/lib/logger';
import { sanitizeForLog } from '@/lib/sanitize-core';
import { ucpCartRouteParamsSchema } from '@/schemas/ucp-cart-route-params';

type RouteProps = { params: Promise<{ id: string }> };
export async function GET(request: NextRequest, props: RouteProps) {
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

  const query = await readAgenticQueryRequest({ request });
  if (!query.ok) return query.response;

  const context = await resolveUcpCartContext(request);
  if (!context.ok) return context.response;

  const canonical = await handleCanonicalUcpCart({
    merchant: context.merchant,
    cartId: parsedParams.data.id,
    agentId: query.agentId,
    action: 'read',
  });
  if (canonical)
    return NextResponse.json(canonical.body, { status: canonical.status });

  const cartResult = await loadUcpCartSession({
    cartId: parsedParams.data.id,
    merchantId: context.merchant.id,
    supabase: context.supabase,
  });
  if (cartResult.error) {
    logger.error({
      error: sanitizeForLog(cartResult.error),
      message: 'Failed to read UCP cart',
      route: 'carts.get',
    });
    return NextResponse.json({ error: 'Database error' }, { status: 500 });
  }
  if (!cartResult.cart) {
    return NextResponse.json({ error: 'Cart not found' }, { status: 404 });
  }
  if (ucpCartCallerMismatch(cartResult.cart, query.agentId)) {
    return NextResponse.json({ error: 'Cart not found' }, { status: 404 });
  }

  return buildUcpCartStateResponse({
    cart: cartResult.cart,
    merchant: context.merchant,
    request,
    supabase: context.supabase,
  });
}
