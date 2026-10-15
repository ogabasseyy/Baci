import type { NextRequest } from 'next/server';
import { getCartProofEnvironment } from '@/lib/cart/cart-runtime-env';
import {
  type CartRequestContextDeps,
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
import { createCart, getCart } from '@/lib/cart/service';
import {
  CartSessionConfigError,
  cartSessionCookieMaxAge,
  issueCartSessionProof,
  verifyCartSessionProof,
} from '@/lib/cart/session-proof';
import { checkCsrfProtection } from '@/lib/csrf';
import { getClientIdentifier } from '@/lib/rate-limit';
import { getCurrentSlugForAlias } from '@/lib/slug-alias-cache';
import { createAnonClient } from '@/lib/supabase/anon';
import { createCartRequestSchema } from '@/schemas/cart';

function contextDeps(
  requireScope: CartRequestContextDeps['requireScope'],
  wrongScopeError: CartRequestContextDeps['wrongScopeError']
): CartRequestContextDeps {
  return {
    merchant: {
      resolveAlias: getCurrentSlugForAlias,
      rpcClient: createAnonClient(),
      loadMerchantFeatures: createAnonMerchantFeatureLookup(createAnonClient()),
    },
    requireScope,
    verify: (proof) =>
      verifyCartSessionProof(proof, {
        environment: getCartProofEnvironment(),
      }),
    wrongScopeError,
  };
}

/**
 * GET /api/storefront/cart
 *
 * Returns the authorized snapshot for a session proof. Preview-safe:
 * creates no cart, sets no cookie and mints no session. A bootstrap
 * proof (no cart yet) reads as not-found.
 */
export async function GET(request: NextRequest) {
  try {
    const context = await resolveCartRequestContext(
      request,
      contextDeps('session', 'not_found')
    );
    if (!context.ok) {
      return cartErrorResponse(context.error);
    }

    const quota = await checkCartQuota({
      merchantId: context.merchant.id,
      operation: 'snapshot',
      subject: context.principal.principalId,
    });
    if (!quota.allowed) {
      return cartErrorResponse('quota_exceeded');
    }

    const result = await getCart({
      client: createCartScopedClient(context.principal),
      principal: context.principal,
    });
    if (!result.ok) {
      return cartErrorResponse(
        result.code,
        result.cart ? { cart: result.cart } : undefined
      );
    }
    return cartJsonResponse({ cart: result.cart, warnings: result.warnings });
  } catch (error) {
    console.error('Unexpected error in GET /api/storefront/cart:', {
      message: error instanceof Error ? error.message : 'unknown',
    });
    return cartErrorResponse('temporarily_unavailable');
  }
}

/**
 * POST /api/storefront/cart
 *
 * Lazily creates one guest cart for a bootstrap proof and returns the
 * upgraded session proof (body plus merchant-namespaced cookie). The
 * creation key makes response-loss retries converge instead of
 * duplicating the cart. Client JSON never overrides the resolved
 * merchant.
 */
export async function POST(request: NextRequest) {
  try {
    const csrf = await checkCsrfProtection(request);
    if (!csrf.valid) {
      return cartErrorResponse('forbidden');
    }

    // Authenticate before reading the creation body, like every other
    // protected cart mutation route: unauthenticated callers must not
    // drive body parsing or schema validation first.
    const context = await resolveCartRequestContext(
      request,
      contextDeps('bootstrap', 'forbidden')
    );
    if (!context.ok) {
      return cartErrorResponse(context.error);
    }

    const rawBody = await readCartJsonBody(request);
    if (!rawBody.ok) {
      return cartErrorResponse('invalid_request');
    }
    const parsedBody = createCartRequestSchema.safeParse(rawBody.body);
    if (!parsedBody.success) {
      return cartErrorResponse('invalid_request');
    }

    const quota = await checkCartQuota({
      merchantId: context.merchant.id,
      operation: 'create',
      subject: context.principal.principalId,
    });
    if (!quota.allowed) {
      return cartErrorResponse('quota_exceeded');
    }
    // Bootstrap mints a fresh principal per call, so the per-principal
    // budget alone can be reset by rotating bootstrap proofs; the same
    // budget also applies per client identity.
    const clientQuota = await checkCartQuota({
      merchantId: context.merchant.id,
      operation: 'create',
      subject: getClientIdentifier(request),
    });
    if (!clientQuota.allowed) {
      return cartErrorResponse('quota_exceeded');
    }

    const result = await createCart(
      {
        client: createCartScopedClient(context.principal),
        principal: context.principal,
      },
      {
        currency: parsedBody.data.currency,
        lines: parsedBody.data.lines,
        operationId: parsedBody.data.operationId,
      }
    );
    if (!result.ok) {
      return cartErrorResponse(
        result.code,
        result.cart ? { cart: result.cart } : undefined
      );
    }
    if (!result.grantId) {
      return cartErrorResponse('temporarily_unavailable');
    }

    let proof: string;
    try {
      proof = issueCartSessionProof(
        {
          cartId: result.cart.cartId,
          grantId: result.grantId,
          grantExpiresAt: result.cart.expiresAt,
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

    const response = cartJsonResponse(
      {
        cart: result.cart,
        operationId: result.operationId,
        ...(requestUsesDeviceProof(request) ? { proof } : {}),
        replayed: result.replayed,
        warnings: result.warnings,
      },
      { status: 201 }
    );
    const cookieMaxAge = cartSessionCookieMaxAge(result.cart.expiresAt);
    if (cookieMaxAge > 0) {
      setCartSessionCookie(response, context.merchant.id, proof, cookieMaxAge);
    }
    return response;
  } catch (error) {
    console.error('Unexpected error in POST /api/storefront/cart:', {
      message: error instanceof Error ? error.message : 'unknown',
    });
    return cartErrorResponse('temporarily_unavailable');
  }
}
