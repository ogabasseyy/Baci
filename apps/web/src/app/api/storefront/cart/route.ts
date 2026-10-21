import { CART_FULL_SESSION_OPERATIONS } from '@baci/shared/cart';
import type { NextRequest } from 'next/server';
import { getCartProofEnvironment } from '@/lib/cart/cart-runtime-env';
import { upgradeLegacySessionPrincipal } from '@/lib/cart/grant-operations';
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
  cartSessionCookieMaxAge,
  issueCartSessionProof,
  verifyCartSessionProof,
} from '@/lib/cart/session-proof';
import { voucherAttachmentsValid } from '@/lib/cart/voucher-attachments';
import { checkCsrfProtection } from '@/lib/csrf';
import { getTrustedClientIdentifier } from '@/lib/rate-limit';
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
 * creates no cart and mints no session. A bootstrap proof (no cart
 * yet) reads as not-found. A legacy session proof that predates the
 * operations claim is upgraded here: the live grant's verified
 * operations are loaded and the proof is re-issued with them (cookie,
 * plus body for device callers), so older carts stay editable.
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

    const client = createCartScopedClient(context.principal);
    const result = await getCart({
      client,
      principal: context.principal,
    });
    if (!result.ok) {
      return cartErrorResponse(
        result.code,
        result.cart ? { cart: result.cart } : undefined
      );
    }
    let proof: string | null = null;
    const upgraded = await upgradeLegacySessionPrincipal(
      client,
      context.principal
    );
    if (upgraded && upgraded !== context.principal) {
      try {
        proof = issueCartSessionProof(
          {
            allowedOperations: upgraded.allowedOperations,
            cartId: upgraded.cartId,
            grantId: upgraded.grantId,
            // Cap at the live grant expiry: another linked session can
            // extend the cart beyond this grant, and a proof that
            // outlives its grant verifies but cannot authorize.
            grantExpiresAt:
              upgraded.liveGrantExpiresAt ?? result.cart.expiresAt,
            merchantId: context.merchant.id,
            principalId: upgraded.principalId,
            scope: 'session',
          },
          { environment: getCartProofEnvironment() }
        );
      } catch (error) {
        console.error('Legacy cart session proof upgrade failed', {
          message: error instanceof Error ? error.message : 'unknown',
        });
      }
    }
    const response = cartJsonResponse({
      cart: result.cart,
      ...(proof && requestUsesDeviceProof(request) ? { proof } : {}),
      warnings: result.warnings,
    });
    // Cap the cookie at the earlier of the grant expiry the upgraded
    // proof was capped to and the cart expiry.
    const cookieExpiry =
      upgraded?.liveGrantExpiresAt &&
      Date.parse(upgraded.liveGrantExpiresAt) <
        Date.parse(result.cart.expiresAt)
        ? upgraded.liveGrantExpiresAt
        : result.cart.expiresAt;
    const cookieMaxAge = cartSessionCookieMaxAge(cookieExpiry);
    if (proof && cookieMaxAge > 0) {
      setCartSessionCookie(response, context.merchant.id, proof, cookieMaxAge);
    }
    return response;
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
      // Keep scope rejection distinct from the CSRF forbidden response.
      contextDeps('bootstrap', 'unauthorized')
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
    if (!voucherAttachmentsValid(parsedBody.data.lines ?? [])) {
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
      subject: getTrustedClientIdentifier(request),
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

    let proof: string | null = null;
    try {
      proof = issueCartSessionProof(
        {
          // Fresh grant minted by the create RPC with the full
          // session vocabulary (the grants-table default).
          allowedOperations: CART_FULL_SESSION_OPERATIONS,
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
      // Creation is committed, but the client must retain its stable creation
      // operation until proof installation succeeds. The RPC replays the same
      // cart and grant when that exact request is retried.
      console.error('Cart session proof issue failed after create commit', {
        message: error instanceof Error ? error.message : 'unknown',
      });
      return cartErrorResponse('temporarily_unavailable');
    }

    const response = cartJsonResponse(
      {
        cart: result.cart,
        operationId: result.operationId,
        ...(proof && requestUsesDeviceProof(request) ? { proof } : {}),
        replayed: result.replayed,
        warnings: result.warnings,
      },
      { status: 201 }
    );
    const cookieMaxAge = cartSessionCookieMaxAge(result.cart.expiresAt);
    if (proof && cookieMaxAge > 0) {
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
