import type { NextRequest } from 'next/server';
import { getCartProofEnvironment } from '@/lib/cart/cart-runtime-env';
import { revokeCartDeviceGrants } from '@/lib/cart/device-session';
import { cartSessionCookieName } from '@/lib/cart/principal';
import {
  readCartJsonBody,
  resolveCartRequestContext,
} from '@/lib/cart/request-context';
import { checkCartQuota } from '@/lib/cart/request-quota';
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
      // Revocation stays available independently of shared-cart
      // enrollment: sign-out calls this unconditionally, and a
      // merchant without the flag (the default) or mid-rollback must
      // still be able to retire device authority. No feature lookup.
      merchant: {
        allowUnpublished: true,
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
    if (!context.ok) {
      const response = cartErrorResponse(context.error);
      if (
        (context.error === 'invalid_proof' ||
          context.error === 'expired_proof') &&
        context.merchant
      ) {
        // The presented proof can never verify again (for example
        // after a signing-key rotation): expire only this merchant's
        // cookie so the dead credential does not keep blocking legacy
        // orders, while other merchants' cookies on a shared host
        // stay valid.
        response.cookies.set(cartSessionCookieName(context.merchant.id), '', {
          httpOnly: true,
          maxAge: 0,
          path: '/',
          sameSite: 'lax',
          secure: process.env.NODE_ENV === 'production',
        });
      }
      return response;
    }
    const quota = await checkCartQuota({
      merchantId: context.merchant.id,
      operation: 'session_revoke',
      subject: context.principal.principalId,
    });
    if (!quota.allowed) return cartErrorResponse('quota_exceeded');
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
