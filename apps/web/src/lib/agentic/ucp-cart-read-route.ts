import type { SupabaseClient } from '@supabase/supabase-js';
import { type NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import { sanitizeForLog } from '@/lib/sanitize-core';
import type { AgenticMerchantContext } from './merchant-context';
import type { handleCanonicalUcpCart } from './ucp-canonical-cart';
import type { buildUcpCartStateResponse } from './ucp-cart-route-support';
import type { loadUcpCartSession } from './ucp-cart-session-read';
import { ucpCartCallerMismatch } from './ucp-cart-storage';

/** Reads through the authority supplied by the authenticated route. */
export async function readUcpCart(
  input: {
    request: NextRequest;
    cartId: string;
    agentId: string | null;
    merchant: AgenticMerchantContext;
    supabase: SupabaseClient;
  },
  deps: {
    canonical: typeof handleCanonicalUcpCart;
    load: typeof loadUcpCartSession;
    respond: typeof buildUcpCartStateResponse;
  }
) {
  const canonical = await deps.canonical({
    merchant: input.merchant,
    cartId: input.cartId,
    agentId: input.agentId,
    action: 'read',
  });
  if (canonical)
    return NextResponse.json(canonical.body, { status: canonical.status });

  const cartResult = await deps.load({
    cartId: input.cartId,
    merchantId: input.merchant.id,
    supabase: input.supabase,
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
  if (ucpCartCallerMismatch(cartResult.cart, input.agentId)) {
    return NextResponse.json({ error: 'Cart not found' }, { status: 404 });
  }

  return deps.respond({
    cart: cartResult.cart,
    merchant: input.merchant,
    request: input.request,
    supabase: input.supabase,
  });
}
