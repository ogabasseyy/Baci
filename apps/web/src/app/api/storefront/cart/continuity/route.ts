import type { NextRequest } from 'next/server';
import { getCartProofEnvironment } from '@/lib/cart/cart-runtime-env';
import {
  loadExperienceCartContinuity,
  verifyContinuitySubject,
} from '@/lib/cart/experience-cart-continuity';
import {
  checkCartQuota,
  createAnonMerchantFeatureLookup,
  resolveCartRequestContext,
} from '@/lib/cart/request-context';
import { cartErrorResponse, cartJsonResponse } from '@/lib/cart/response';
import { createCartScopedClient } from '@/lib/cart/scoped-client';
import { verifyCartSessionProof } from '@/lib/cart/session-proof';
import { getCurrentSlugForAlias } from '@/lib/slug-alias-cache';
import { createAnonClient } from '@/lib/supabase/anon';
import { createClient } from '@/lib/supabase/server';
import { experienceCartContinuitySchema } from '@/schemas/experience-cart-continuity';
/** Read-only, same merchant/proof/origin rules and quota as the existing snapshot. */
export async function GET(request: NextRequest) {
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
    if (!context.principal.cartId || !context.principal.grantId)
      return cartErrorResponse('not_found');
    const quota = await checkCartQuota({
      merchantId: context.merchant.id,
      operation: 'snapshot',
      subject: context.principal.principalId,
    });
    if (!quota.allowed) return cartErrorResponse('quota_exceeded');
    const auth = await createClient();
    const customer = await verifyContinuitySubject(() => auth.auth.getUser());
    if (customer.id !== null)
      return Response.json(
        {
          error: 'Use the trusted native cart.',
          code: 'ACCOUNT_CART_REQUIRES_TRUSTED_FLOW',
        },
        { status: 403, headers: { 'Cache-Control': 'private, no-store' } }
      );
    const fingerprint = await loadExperienceCartContinuity(
      createCartScopedClient(context.principal),
      context.principal,
      customer
    );
    if (!fingerprint) return cartErrorResponse('unauthorized');
    return cartJsonResponse(
      experienceCartContinuitySchema.parse({ fingerprint })
    );
  } catch {
    return cartErrorResponse('temporarily_unavailable');
  }
}
