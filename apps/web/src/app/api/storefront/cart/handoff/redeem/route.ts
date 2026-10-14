import type { NextRequest } from 'next/server';
import { getCartProofEnvironment } from '@/lib/cart/cart-runtime-env';
import {
  detectHandoffCaller,
  isHandoffWebOriginAllowed,
  redeemCartHandoff,
} from '@/lib/cart/handoff';
import {
  type CartRequestContextDeps,
  checkCartQuota,
  readCartJsonBody,
  resolveCartRequestContext,
} from '@/lib/cart/request-context';
import {
  cartErrorResponse,
  cartJsonResponse,
  setCartSessionCookie,
} from '@/lib/cart/response';
import { createCartScopedClient } from '@/lib/cart/scoped-client';
import {
  CART_BOOTSTRAP_PROOF_TTL_SECONDS,
  CART_SESSION_PROOF_TTL_SECONDS,
  CART_SESSION_PROOF_VERSION,
  CartSessionConfigError,
  issueCartSessionProof,
  verifyCartSessionProof,
} from '@/lib/cart/session-proof';
import { checkCsrfProtection } from '@/lib/csrf';
import { getCurrentSlugForAlias } from '@/lib/slug-alias-cache';
import { createAnonClient } from '@/lib/supabase/anon';
import { cartHandoffRedeemRequestSchema } from '@/schemas/cart';

/**
 * POST /api/storefront/cart/handoff/redeem
 *
 * Consumes a handoff grant for a destination attempt (connect, merge
 * or keep-existing) and returns the destination session proof. The
 * pairing token travels only in the POST body and is hashed at the
 * boundary; unexpected faults log a fixed shape so pairing material
 * can never reach response logs.
 */
export async function POST(request: NextRequest) {
  try {
    const csrf = await checkCsrfProtection(request);
    if (!csrf.valid) {
      return cartErrorResponse('forbidden');
    }

    // Authenticate before reading the body: protected-route work and
    // response selection must not be driven by unauthenticated payloads.
    const context = await resolveCartRequestContext(request, {
      merchant: {
        resolveAlias: getCurrentSlugForAlias,
        rpcClient: createAnonClient(),
      },
      requireScope: 'any',
      verify: (proof) =>
        verifyCartSessionProof(proof, {
          environment: getCartProofEnvironment(),
        }),
      wrongScopeError: 'not_found',
    } satisfies CartRequestContextDeps);
    if (!context.ok) {
      return cartErrorResponse(context.error);
    }
    const principal = context.principal;

    const rawBody = await readCartJsonBody(request);
    if (!rawBody.ok) {
      return cartErrorResponse('invalid_request');
    }
    const parsedBody = cartHandoffRedeemRequestSchema.safeParse(rawBody.body);
    if (!parsedBody.success) {
      return cartErrorResponse('invalid_request');
    }
    const body = parsedBody.data;

    if (body.choice === 'merge' && principal.scope !== 'session') {
      return cartErrorResponse('invalid_request');
    }
    if (
      body.destCartId !== undefined &&
      (principal.scope !== 'session' || body.destCartId !== principal.cartId)
    ) {
      return cartErrorResponse('invalid_request');
    }

    // The destination is bound to the proof transport, not the Origin
    // label alone: native redemption must present the device-held
    // Bearer cart proof, and web redemption must arrive from an
    // allowlisted merchant origin. Omitting Origin therefore cannot
    // reclassify a browser session as a device redemption.
    const bearerProof = request.headers
      .get('authorization')
      ?.match(/^\s*bearer\s+(.+?)\s*$/i)?.[1]
      ?.trim();
    const hasDeviceProof =
      bearerProof?.startsWith(`${CART_SESSION_PROOF_VERSION}.`) ?? false;
    const caller = detectHandoffCaller(request.headers.get('origin'));
    if (caller === 'native' && !hasDeviceProof) {
      return cartErrorResponse('forbidden');
    }
    if (
      caller === 'web' &&
      !isHandoffWebOriginAllowed(request.headers.get('origin'), {
        customDomain: context.merchant.customDomain,
        rootDomain: process.env.NEXT_PUBLIC_ROOT_DOMAIN ?? 'usebaci.com',
        slug: context.merchant.slug,
      })
    ) {
      return cartErrorResponse('forbidden');
    }

    const quota = await checkCartQuota({
      merchantId: context.merchant.id,
      operation: 'handoff_redeem',
      subject: principal.principalId,
    });
    if (!quota.allowed) {
      return cartErrorResponse('quota_exceeded');
    }

    const redeemed = await redeemCartHandoff(
      createCartScopedClient(principal),
      {
        attemptId: body.attemptId,
        caller,
        choice: body.choice,
        destCartId:
          principal.scope === 'session'
            ? (principal.cartId ?? undefined)
            : undefined,
        expectedDestVersion: body.expectedDestVersion,
        expectedIncomingVersion: body.expectedIncomingVersion,
        handoffId: body.handoffId,
        lines: body.lines,
        resolutions: body.resolutions,
        token: body.token,
      }
    );
    if (!redeemed.ok) {
      return cartErrorResponse(redeemed.code, {
        ...(redeemed.cart ? { cart: redeemed.cart } : null),
        ...(redeemed.conflicts ? { conflicts: redeemed.conflicts } : null),
        ...(redeemed.incomingVersion != null
          ? { incomingVersion: redeemed.incomingVersion }
          : null),
        ...(redeemed.destVersion != null
          ? { destVersion: redeemed.destVersion }
          : null),
      });
    }

    let proof: string;
    let maxAge: number;
    try {
      if (redeemed.cart && redeemed.grantId) {
        proof = issueCartSessionProof(
          {
            cartId: redeemed.cart.cartId,
            grantId: redeemed.grantId,
            merchantId: context.merchant.id,
            principalId: principal.principalId,
            scope: 'session',
          },
          { environment: getCartProofEnvironment() }
        );
        maxAge = CART_SESSION_PROOF_TTL_SECONDS;
      } else if (!redeemed.cart && !redeemed.grantId) {
        proof = issueCartSessionProof(
          {
            cartId: null,
            grantId: null,
            merchantId: context.merchant.id,
            principalId: principal.principalId,
            scope: 'bootstrap',
          },
          { environment: getCartProofEnvironment() }
        );
        maxAge = CART_BOOTSTRAP_PROOF_TTL_SECONDS;
      } else {
        return cartErrorResponse('temporarily_unavailable');
      }
    } catch (error) {
      if (error instanceof CartSessionConfigError) {
        return cartErrorResponse('temporarily_unavailable');
      }
      throw error;
    }

    const response = cartJsonResponse({
      cart: redeemed.cart,
      choice: redeemed.choice,
      proof,
      replayed: redeemed.replayed,
      warnings: redeemed.warnings,
    });
    setCartSessionCookie(response, context.merchant.id, proof, maxAge);
    return response;
  } catch {
    console.error(
      'Unexpected error in POST /api/storefront/cart/handoff/redeem'
    );
    return cartErrorResponse('temporarily_unavailable');
  }
}
