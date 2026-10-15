import type { NextRequest } from 'next/server';
import { getCartProofEnvironment } from '@/lib/cart/cart-runtime-env';
import { prepareCartCheckout } from '@/lib/cart/checkout-transition';
import {
  checkCartQuota,
  createAnonMerchantFeatureLookup,
  readCartJsonBody,
  requestUsesDeviceProof,
  resolveCartRequestContext,
} from '@/lib/cart/request-context';
import {
  cartErrorResponse,
  cartJsonResponse,
  setCartSessionCookie,
} from '@/lib/cart/response';
import { createCartScopedClient } from '@/lib/cart/scoped-client';
import {
  cartSessionCookieMaxAge,
  issueCartSessionProof,
  verifyCartSessionProof,
} from '@/lib/cart/session-proof';
import { checkCsrfProtection } from '@/lib/csrf';
import { getCurrentSlugForAlias } from '@/lib/slug-alias-cache';
import { createAnonClient } from '@/lib/supabase/anon';
import { sharedCartPrepareRequestSchema } from '@/schemas/cart';

/**
 * POST /api/storefront/cart/checkout
 *
 * Reviews the current authoritative cart for checkout: validated lines,
 * estimates and one active session reference. Never submits an order or
 * starts payment. Version drift fails with the live version so the
 * client reconciles instead of submitting stale lines.
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
        loadMerchantFeatures: createAnonMerchantFeatureLookup(
          createAnonClient()
        ),
      },
      requireScope: 'session',
      verify: (proof) =>
        verifyCartSessionProof(proof, {
          environment: getCartProofEnvironment(),
        }),
      wrongScopeError: 'not_found',
    });
    if (!context.ok) {
      return cartErrorResponse(context.error);
    }

    const rawBody = await readCartJsonBody(request);
    if (!rawBody.ok) {
      return cartErrorResponse('invalid_request');
    }
    const parsedBody = sharedCartPrepareRequestSchema.safeParse(rawBody.body);
    if (!parsedBody.success) {
      return cartErrorResponse('invalid_request');
    }

    const quota = await checkCartQuota({
      merchantId: context.merchant.id,
      operation: 'checkout_prepare',
      subject: context.principal.principalId,
    });
    if (!quota.allowed) {
      return cartErrorResponse('quota_exceeded');
    }

    const result = await prepareCartCheckout(
      {
        client: createCartScopedClient(context.principal),
        principal: context.principal,
      },
      {
        cartId: parsedBody.data.cartId,
        expectedVersion: parsedBody.data.expectedVersion,
        operationId: parsedBody.data.operationId,
      }
    );
    if (!result.ok) {
      return cartErrorResponse(
        result.code,
        result.currentVersion === null
          ? undefined
          : { currentVersion: result.currentVersion }
      );
    }
    // Renew the session proof bound to the prepared session's actual
    // expiry, but never shorten the credential the shopper already
    // holds: a longer-lived incoming proof stays authoritative so an
    // abandoned checkout does not strand a still-active cart. The
    // renewal is still capped at the live grant expiry returned by the
    // prepare RPC (which extends the grant to cover the session, up to
    // the absolute cart lifetime), so a proof never outlives the grant
    // it authenticates.
    const desiredProofExpiry =
      Date.parse(result.sessionExpiresAt) >
      Date.parse(context.principal.expiresAt)
        ? result.sessionExpiresAt
        : context.principal.expiresAt;
    const proofExpiresAt =
      Date.parse(result.grantExpiresAt) < Date.parse(desiredProofExpiry)
        ? result.grantExpiresAt
        : desiredProofExpiry;
    let proof: string | null = null;
    try {
      proof = issueCartSessionProof(
        {
          allowedOperations: context.principal.allowedOperations,
          cartId: context.principal.cartId,
          grantId: context.principal.grantId,
          grantExpiresAt: proofExpiresAt,
          merchantId: context.merchant.id,
          principalId: context.principal.principalId,
          scope: 'session',
        },
        { environment: getCartProofEnvironment() }
      );
    } catch (error) {
      // Preparation already committed the session: return the reviewed
      // snapshot without a renewed proof (the incoming proof governs
      // until it expires) rather than failing a committed checkout.
      console.error('Cart session proof reissue failed after prepare', {
        message: error instanceof Error ? error.message : 'unknown',
      });
    }
    const response = cartJsonResponse({
      ...(proof && requestUsesDeviceProof(request) ? { proof } : {}),
      replayed: result.replayed,
      sessionReused: result.sessionReused,
      snapshot: result.snapshot,
      sessionExpiresAt: result.sessionExpiresAt,
    });
    const cookieMaxAge = cartSessionCookieMaxAge(proofExpiresAt);
    if (proof && cookieMaxAge > 0) {
      setCartSessionCookie(response, context.merchant.id, proof, cookieMaxAge);
    }
    return response;
  } catch (error) {
    console.error('Unexpected error in POST /api/storefront/cart/checkout:', {
      message: error instanceof Error ? error.message : 'unknown',
    });
    return cartErrorResponse('temporarily_unavailable');
  }
}
