import type { NextRequest } from 'next/server';
import { getCartProofEnvironment } from '@/lib/cart/cart-runtime-env';
import {
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
import { mutateCart } from '@/lib/cart/service';
import {
  CART_SESSION_PROOF_TTL_SECONDS,
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

    const rawBody = await readCartJsonBody(request);
    if (!rawBody.ok) {
      return cartErrorResponse('invalid_request');
    }
    const parsedBody = sharedCartMutationRequestSchema.safeParse(rawBody.body);
    if (!parsedBody.success) {
      return cartErrorResponse('invalid_request');
    }

    const context = await resolveCartRequestContext(request, {
      merchant: {
        resolveAlias: getCurrentSlugForAlias,
        rpcClient: createAnonClient(),
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
    const proof = issueCartSessionProof(
      {
        cartId: context.principal.cartId,
        grantId: context.principal.grantId,
        grantExpiresAt: result.cart.expiresAt,
        merchantId: context.merchant.id,
        principalId: context.principal.principalId,
        scope: 'session',
      },
      { environment: getCartProofEnvironment() }
    );
    const response = cartJsonResponse({
      proof,
      cart: result.cart,
      operationId: result.operationId,
      replayed: result.replayed,
      warnings: result.warnings,
    });
    const maxAge = Math.min(
      CART_SESSION_PROOF_TTL_SECONDS,
      Math.floor((Date.parse(result.cart.expiresAt) - Date.now()) / 1000)
    );
    // A non-positive lifetime would delete the cookie the body proof just
    // renewed; omit the cookie instead and let the body proof govern.
    if (maxAge > 0) {
      setCartSessionCookie(response, context.merchant.slug, proof, maxAge);
    }
    return response;
  } catch (error) {
    console.error('Unexpected error in POST /api/storefront/cart/commands:', {
      message: error instanceof Error ? error.message : 'unknown',
    });
    return cartErrorResponse('temporarily_unavailable');
  }
}
