import type { NextRequest } from 'next/server';
import { getCartProofEnvironment } from '@/lib/cart/cart-runtime-env';
import { getCartRealtimeAccess } from '@/lib/cart/realtime-access';
import {
  checkCartQuota,
  createAnonMerchantFeatureLookup,
  resolveCartRequestContext,
} from '@/lib/cart/request-context';
import { cartErrorResponse, cartJsonResponse } from '@/lib/cart/response';
import { verifyCartSessionProof } from '@/lib/cart/session-proof';
import { getCurrentSlugForAlias } from '@/lib/slug-alias-cache';
import { createAnonClient } from '@/lib/supabase/anon';

/** Mints only receive authority, after live grant and enrollment checks. */
export async function GET(request: NextRequest): Promise<Response> {
  try {
    const context = await resolveCartRequestContext(request, {
      merchant: {
        resolveAlias: getCurrentSlugForAlias,
        rpcClient: createAnonClient(),
        loadMerchantFeatures: createAnonMerchantFeatureLookup(
          createAnonClient()
        ),
      },
      requireScope: 'session',
      wrongScopeError: 'not_found',
      verify: (proof) =>
        verifyCartSessionProof(proof, {
          environment: getCartProofEnvironment(),
        }),
    });
    if (!context.ok) return cartErrorResponse(context.error);
    const quota = await checkCartQuota({
      merchantId: context.merchant.id,
      operation: 'snapshot',
      subject: context.principal.principalId,
    });
    if (!quota.allowed) return cartErrorResponse('quota_exceeded');
    const result = await getCartRealtimeAccess(context.principal);
    if (!result.ok) return cartErrorResponse(result.code);
    return cartJsonResponse({
      topic: result.topic,
      token: result.token,
      expiresAt: result.expiresAt,
    });
  } catch {
    return cartErrorResponse('temporarily_unavailable');
  }
}
