import type { NextRequest } from 'next/server';
import { getCartProofEnvironment } from '@/lib/cart/cart-runtime-env';
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
import { mutateCart } from '@/lib/cart/service';
import {
  cartSessionCookieMaxAge,
  issueCartSessionProof,
  verifyCartSessionProof,
} from '@/lib/cart/session-proof';
import { checkCsrfProtection } from '@/lib/csrf';
import { getCurrentSlugForAlias } from '@/lib/slug-alias-cache';
import { createAnonClient } from '@/lib/supabase/anon';
import { sharedCartMutationRequestSchema } from '@/schemas/cart';

/**
 * POST /api/storefront/cart/commands
 *
 * Applies one versioned, idempotent command for a session proof.
 * Stale versions fail with the current cart so the client reconciles
 * instead of overwriting newer state; operation-id retries converge.
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
    const parsedBody = sharedCartMutationRequestSchema.safeParse(rawBody.body);
    if (!parsedBody.success) {
      return cartErrorResponse('invalid_request');
    }

    const quota = await checkCartQuota({
      merchantId: context.merchant.id,
      operation: 'commands',
      subject: context.principal.principalId,
    });
    if (!quota.allowed) {
      return cartErrorResponse('quota_exceeded');
    }

    const result = await mutateCart(
      {
        client: createCartScopedClient(context.principal),
        principal: context.principal,
      },
      {
        command: parsedBody.data.command,
        expectedVersion: parsedBody.data.expectedVersion,
        operationId: parsedBody.data.operationId,
      }
    );
    if (!result.ok) {
      return cartErrorResponse(
        result.code,
        result.cart ? { cart: result.cart } : undefined
      );
    }
    // The mutation has already committed. A renewed proof must never
    // outlive the grant, so if reissue crosses the grant expiry the
    // committed cart is returned without a new proof instead of
    // surfacing the committed change as a 503; the existing proof and
    // cookie govern until they expire, and retries replay by
    // operation id.
    let proof: string | null = null;
    try {
      proof = issueCartSessionProof(
        {
          allowedOperations: context.principal.allowedOperations,
          cartId: context.principal.cartId,
          grantId: context.principal.grantId,
          grantExpiresAt: result.cart.expiresAt,
          merchantId: context.merchant.id,
          principalId: context.principal.principalId,
          scope: 'session',
        },
        { environment: getCartProofEnvironment() }
      );
    } catch (error) {
      // Never surface a committed mutation as a failure: the existing
      // proof governs until it expires and retries replay by operation
      // id. Log the failure so a provisioning gap stays visible instead
      // of trapping the shopper in a repeating 503.
      console.error('Cart session proof reissue failed after commit', {
        message: error instanceof Error ? error.message : 'unknown',
      });
    }
    const response = cartJsonResponse({
      ...(proof && requestUsesDeviceProof(request) ? { proof } : {}),
      cart: result.cart,
      operationId: result.operationId,
      replayed: result.replayed,
      warnings: result.warnings,
    });
    const maxAge = cartSessionCookieMaxAge(result.cart.expiresAt);
    // A non-positive lifetime would delete the cookie the body proof just
    // renewed; omit the cookie instead and let the body proof govern.
    if (proof && maxAge > 0) {
      setCartSessionCookie(response, context.merchant.id, proof, maxAge);
    }
    return response;
  } catch (error) {
    console.error('Unexpected error in POST /api/storefront/cart/commands:', {
      message: error instanceof Error ? error.message : 'unknown',
    });
    return cartErrorResponse('temporarily_unavailable');
  }
}
