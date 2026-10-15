import type { NextRequest } from 'next/server';
import { getCartProofEnvironment } from '@/lib/cart/cart-runtime-env';
import { prepareCartCheckout } from '@/lib/cart/checkout-transition';
import {
  checkCartQuota,
  createAnonMerchantFeatureLookup,
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
  CartSessionConfigError,
  cartSessionCookieMaxAge,
  issueCartSessionProof,
  verifyCartSessionProof,
} from '@/lib/cart/session-proof';
import { checkCsrfProtection } from '@/lib/csrf';
import { getCurrentSlugForAlias } from '@/lib/slug-alias-cache';
import { createAnonClient } from '@/lib/supabase/anon';
import { sharedCartPrepareRequestSchema } from '@/schemas/cart';

/** Mirrors the 30-minute checkout session lifetime minted in SQL. */
const CHECKOUT_SESSION_WINDOW_MS = 30 * 60 * 1000;

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
    // Renew the session proof for the checkout session window (the SQL
    // mints/extends the session, cart and preparing grant to a shared
    // 30-minute horizon) so a checkout prepared near cart expiry stays
    // submittable for its whole session lifetime.
    const sessionWindowExpiresAt = new Date(
      Date.now() + CHECKOUT_SESSION_WINDOW_MS
    ).toISOString();
    let proof: string;
    try {
      proof = issueCartSessionProof(
        {
          cartId: context.principal.cartId,
          grantId: context.principal.grantId,
          grantExpiresAt: sessionWindowExpiresAt,
          merchantId: context.merchant.id,
          principalId: context.principal.principalId,
          scope: 'session',
        },
        { environment: getCartProofEnvironment() }
      );
    } catch (error) {
      if (error instanceof CartSessionConfigError) {
        return cartErrorResponse('temporarily_unavailable');
      }
      throw error;
    }
    const response = cartJsonResponse({
      proof,
      replayed: result.replayed,
      sessionReused: result.sessionReused,
      snapshot: result.snapshot,
    });
    const cookieMaxAge = cartSessionCookieMaxAge(sessionWindowExpiresAt);
    if (cookieMaxAge > 0) {
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
