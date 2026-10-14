import type { NextRequest } from 'next/server';
import { getCartProofEnvironment } from '@/lib/cart/cart-runtime-env';
import { revokeCartDeviceGrants } from '@/lib/cart/device-session';
import {
  readCartJsonBody,
  resolveCartRequestContext,
} from '@/lib/cart/request-context';
import {
  cartErrorResponse,
  cartJsonResponse,
  setCartSessionCookie,
} from '@/lib/cart/response';
import { verifyCartSessionProofForRevocation } from '@/lib/cart/session-proof';
import { checkCsrfProtection } from '@/lib/csrf';
import { getCurrentSlugForAlias } from '@/lib/slug-alias-cache';
import { createAnonClient } from '@/lib/supabase/anon';
import { cartRevokeRequestSchema } from '@/schemas/cart-account';
/** Device-scoped revocation never clears shared cart contents or other device grants. */
export async function POST(request: NextRequest): Promise<Response> {
  try {
    if (!(await checkCsrfProtection(request)).valid)
      return cartErrorResponse('forbidden');
    // Authenticate before reading the body: protected-route work and
    // response selection must not be driven by unauthenticated payloads.
    const context = await resolveCartRequestContext(request, {
      merchant: {
        resolveAlias: getCurrentSlugForAlias,
        rpcClient: createAnonClient(),
      },
      requireScope: 'any',
      wrongScopeError: 'not_found',
      verify: (proof) =>
        verifyCartSessionProofForRevocation(proof, {
          environment: getCartProofEnvironment(),
        }),
    });
    if (!context.ok) return cartErrorResponse(context.error);
    const body = await readCartJsonBody(request);
    if (!body.ok || !cartRevokeRequestSchema.safeParse(body.body).success)
      return cartErrorResponse('invalid_request');
    const result = await revokeCartDeviceGrants(context.principal);
    if (!result.ok) return cartErrorResponse(result.code);
    const response = cartJsonResponse({ revoked: true });
    setCartSessionCookie(response, context.merchant.id, '', 0);
    return response;
  } catch {
    return cartErrorResponse('temporarily_unavailable');
  }
}
