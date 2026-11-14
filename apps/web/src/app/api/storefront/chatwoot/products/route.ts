import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { readCartJsonBody } from '@/lib/cart/request-context';
import { checkCartQuota } from '@/lib/cart/request-quota';
import { loadChatwootCartContext } from '@/lib/chatwoot/cart-context';
import {
  ChatwootCommerceContextError,
  verifyChatwootSessionCapability,
} from '@/lib/chatwoot/commerce-context';
import { projectChatwootProductCard } from '@/lib/chatwoot/product-card-projection';
import { checkCsrfProtection } from '@/lib/csrf';
import { resolveMerchantCurrencyConfig } from '@/lib/resolve-merchant-currency';
import { readStorefrontPdpCoreSnapshot } from '@/lib/storefront-pdp-core-snapshot';
import { createAnonClient } from '@/lib/supabase/anon';
import { chatwootProductLookupRequestSchema } from '@/schemas/chatwoot-product-lookup-request';

const NO_STORE_HEADERS = { 'Cache-Control': 'private, no-store' };

function unavailable(status: number, code: string, requestId?: string) {
  return NextResponse.json(
    { ok: false, code, ...(requestId ? { requestId } : {}) },
    { status, headers: NO_STORE_HEADERS }
  );
}

/** Returns one public-safe catalog card within the verified Chatwoot session. */
export async function POST(request: NextRequest) {
  const csrf = await checkCsrfProtection(request);
  if (!csrf.valid) return unavailable(403, 'forbidden');

  const rawBody = await readCartJsonBody(request);
  if (!rawBody.ok) return unavailable(400, 'invalid_request');
  const parsed = chatwootProductLookupRequestSchema.safeParse(rawBody.body);
  if (!parsed.success) return unavailable(400, 'invalid_request');

  let cartContext: Awaited<ReturnType<typeof loadChatwootCartContext>>;
  try {
    cartContext = await loadChatwootCartContext(request);
  } catch {
    return unavailable(503, 'temporarily_unavailable', parsed.data.requestId);
  }
  if (!cartContext.ok) {
    return unavailable(
      cartContext.status,
      cartContext.code,
      parsed.data.requestId
    );
  }

  let capability: Awaited<ReturnType<typeof verifyChatwootSessionCapability>>;
  try {
    capability = await verifyChatwootSessionCapability({
      binding: cartContext.binding,
      sessionToken: parsed.data.sessionToken,
      state: cartContext.state,
    });
  } catch (error) {
    if (error instanceof ChatwootCommerceContextError) {
      const status = error.code === 'invalid_config' ? 503 : 403;
      return unavailable(
        status,
        status === 503 ? 'temporarily_unavailable' : 'invalid_context',
        parsed.data.requestId
      );
    }
    return unavailable(503, 'temporarily_unavailable', parsed.data.requestId);
  }
  if (capability.conversationId !== parsed.data.conversationId) {
    return unavailable(403, 'invalid_context', parsed.data.requestId);
  }

  let quota: Awaited<ReturnType<typeof checkCartQuota>>;
  try {
    quota = await checkCartQuota({
      merchantId: cartContext.state.merchantId,
      operation: 'snapshot',
      subject: cartContext.principal.principalId,
    });
  } catch {
    return unavailable(503, 'temporarily_unavailable', parsed.data.requestId);
  }
  if (!quota.allowed) {
    return unavailable(429, 'quota_exceeded', parsed.data.requestId);
  }

  const client = createAnonClient();
  let currency: string;
  try {
    const { data, error } = await client
      .from('merchants')
      .select('country, payout_currency')
      .eq('id', cartContext.state.merchantId)
      .maybeSingle();
    if (error || !data) {
      return unavailable(503, 'temporarily_unavailable', parsed.data.requestId);
    }
    currency = resolveMerchantCurrencyConfig(data).code;
  } catch {
    return unavailable(503, 'temporarily_unavailable', parsed.data.requestId);
  }

  let snapshot: Awaited<ReturnType<typeof readStorefrontPdpCoreSnapshot>>;
  try {
    snapshot = await readStorefrontPdpCoreSnapshot(client, {
      merchantId: cartContext.state.merchantId,
      productSlug: parsed.data.slug,
    });
  } catch {
    return unavailable(503, 'temporarily_unavailable', parsed.data.requestId);
  }
  if (snapshot.status === 'unavailable') {
    return unavailable(503, 'temporarily_unavailable', parsed.data.requestId);
  }
  if (snapshot.status !== 'found' || snapshot.value.kind !== 'product') {
    return unavailable(404, 'product_unavailable', parsed.data.requestId);
  }

  const projection = projectChatwootProductCard({
    currency,
    merchantId: cartContext.state.merchantId,
    product: snapshot.value.product,
    requestedSlug: parsed.data.slug,
  });
  if (!projection.ok) {
    return unavailable(
      projection.code === 'unsupported_condition_offers' ? 422 : 404,
      projection.code,
      parsed.data.requestId
    );
  }

  return NextResponse.json(
    { ok: true, requestId: parsed.data.requestId, product: projection.product },
    { headers: NO_STORE_HEADERS }
  );
}
