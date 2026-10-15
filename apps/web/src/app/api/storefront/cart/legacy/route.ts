import type { NextRequest } from 'next/server';
import {
  LegacyBridgeError,
  openLegacyCanonicalCart,
  operateLegacyCanonicalCart,
} from '@/lib/cart/legacy-canonical-bridge';
import {
  createAnonMerchantFeatureLookup,
  resolveCartMerchant,
} from '@/lib/cart/merchant-resolution';
import { checkCartQuota, readCartJsonBody } from '@/lib/cart/request-context';
import { cartErrorResponse, cartJsonResponse } from '@/lib/cart/response';
import { getTrustedClientIdentifier } from '@/lib/rate-limit';
import { getCurrentSlugForAlias } from '@/lib/slug-alias-cache';
import { createAnonClient } from '@/lib/supabase/anon';
import { legacyMcpBridgeRequestSchema } from '@/schemas/cart-legacy-bridge';

/** MCP capabilities stay in a header; body fields never select the owner. */
export async function POST(request: NextRequest) {
  const token = request.headers
    .get('authorization')
    ?.match(/^Bearer legacy_mcp_([a-f0-9]{64})$/)?.[1];
  if (!token || !/^[a-f0-9]{64}$/.test(token))
    return cartErrorResponse('unauthorized');
  const quota = await checkCartQuota({
    merchantId: 'legacy-bridge',
    operation: 'handoff_preview',
    subject: getTrustedClientIdentifier(request),
  });
  if (!quota.allowed) return cartErrorResponse('quota_exceeded');
  try {
    const anon = createAnonClient();
    const merchant = await resolveCartMerchant(request, {
      rpcClient: anon,
      resolveAlias: getCurrentSlugForAlias,
      loadMerchantFeatures: createAnonMerchantFeatureLookup(anon),
    });
    if (!merchant.ok) return cartErrorResponse(merchant.error);
    const body = await readCartJsonBody(request);
    const input = legacyMcpBridgeRequestSchema.safeParse(
      body.ok ? body.body : null
    );
    if (!input.success) return cartErrorResponse('invalid_request');
    const cart = await openLegacyCanonicalCart({
      provider: 'mcp',
      handle: token,
      merchant: merchant.merchant,
    });
    const result = await operateLegacyCanonicalCart(cart, {
      ...input.data,
      ...(input.data.productId !== undefined &&
      input.data.quantity !== undefined
        ? {
            edit: {
              productId: input.data.productId,
              quantity: input.data.quantity,
            },
          }
        : {}),
    });
    return cartJsonResponse(result, { status: result.ok ? 200 : 409 });
  } catch (error) {
    if (error instanceof LegacyBridgeError)
      return cartErrorResponse(
        error.code === 'unauthorized' ? 'forbidden' : error.code
      );
    return cartErrorResponse('temporarily_unavailable');
  }
}
