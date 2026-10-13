import type { SupabaseClient } from '@supabase/supabase-js';
import { type NextRequest, NextResponse } from 'next/server';
import { verifyAgenticRequestAccess } from '@/lib/agentic/agent-request-controls';
import { calculateCheckoutSession } from '@/lib/agentic/checkout';
import {
  type AgenticMerchantContext,
  resolveAgenticMerchantContext,
} from '@/lib/agentic/merchant-context';
import { createAgenticScopedSupabaseClient } from '@/lib/agentic/scoped-supabase';
import { buildUcpCartResponse } from '@/lib/agentic/ucp-cart-response';
import {
  coerceUcpCartItems,
  type UcpCartSessionRecord,
} from '@/lib/agentic/ucp-cart-storage';
import { buildRequestScopedStoreUrl } from '@/lib/store-url';
import { createAdminClient } from '@/lib/supabase/admin';

export async function resolveUcpCartContext(request: NextRequest): Promise<
  | {
      merchant: AgenticMerchantContext;
      ok: true;
      supabase: SupabaseClient;
    }
  | { ok: false; response: NextResponse }
> {
  const merchant = await resolveAgenticMerchantContext(createAdminClient());
  if (!merchant) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'Agentic merchant not found' },
        { status: 500 }
      ),
    };
  }
  const agentAccess = verifyAgenticRequestAccess({
    controls: {
      allowlist: merchant.agent_user_agent_allowlist ?? [],
      denylist: merchant.agent_user_agent_denylist ?? [],
    },
    headers: request.headers,
  });
  if (!agentAccess.ok) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: agentAccess.error },
        { status: 403 }
      ),
    };
  }

  return {
    merchant,
    ok: true,
    supabase: createAgenticScopedSupabaseClient({
      merchantId: merchant.id,
      merchantSlug: merchant.slug,
    }),
  };
}

export async function loadUcpCartSession({
  cartId,
  merchantId,
  supabase,
}: {
  cartId: string;
  merchantId: string;
  supabase: SupabaseClient;
}): Promise<{ cart: UcpCartSessionRecord | null; error: unknown }> {
  const { data, error } = await supabase
    .from('agentic_cart_sessions')
    .select(
      'id, agent_id, buyer, cart_id, cart_items, checkout_session_id, created_at, currency, expires_at, merchant_id, metadata, migrated_to_cart_id, shipping_address, status, updated_at'
    )
    .eq('cart_id', cartId)
    .eq('merchant_id', merchantId)
    .maybeSingle();

  if (!data || error) {
    return { cart: null, error };
  }
  const row = data as UcpCartSessionRecord &
    Partial<Record<'migrated_to_cart_id', unknown>>;
  return {
    cart: {
      ...(data as UcpCartSessionRecord),
      migratedToCartId:
        typeof row.migrated_to_cart_id === 'string'
          ? row.migrated_to_cart_id
          : null,
    },
    error,
  };
}

export async function buildUcpCartStateResponse({
  cart,
  merchant,
  request,
  supabase,
}: {
  cart: UcpCartSessionRecord;
  merchant: AgenticMerchantContext;
  request: NextRequest;
  supabase: SupabaseClient;
}) {
  const calculation = await calculateCheckoutSession(
    supabase,
    coerceUcpCartItems(cart.cart_items),
    null,
    cart.currency,
    merchant.id
  );

  return NextResponse.json(
    buildUcpCartResponse({
      cartId: cart.cart_id,
      continueUrl: buildUcpCartContinueUrl({
        cartId: cart.cart_id,
        merchant,
        request,
      }),
      currency: cart.currency,
      lineItems: calculation.lineItems,
      status: cart.status,
      totals: calculation.totals,
    })
  );
}

export function buildUcpCartContinueUrl({
  cartId,
  merchant,
  request,
}: {
  cartId: string;
  merchant: Pick<AgenticMerchantContext, 'custom_domain' | 'slug'>;
  request: NextRequest;
}) {
  const baseUrl = buildRequestScopedStoreUrl(merchant, request.headers);
  return `${baseUrl}/cart?agentic_cart_id=${encodeURIComponent(cartId)}`;
}
