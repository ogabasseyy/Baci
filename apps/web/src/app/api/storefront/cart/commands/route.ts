import type { NextRequest } from 'next/server';
import { getCartProofEnvironment } from '@/lib/cart/cart-runtime-env';
import {
  loadLiveGrantOperations,
  upgradeLegacySessionPrincipal,
} from '@/lib/cart/grant-operations';
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

    // A proof minted before the operations claim carries no claimed
    // authority: load the live grant's verified operations first, or
    // every command would be rejected on an otherwise live cart.
    const client = createCartScopedClient(context.principal);
    const principal = await upgradeLegacySessionPrincipal(
      client,
      context.principal
    );
    if (!principal) {
      return cartErrorResponse('temporarily_unavailable');
    }

    const result = await mutateCart(
      {
        client,
        principal,
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
    // outlive the grant: reload the (just-renewed) grant's authoritative
    // expiry and cap the proof there; the cart expiry alone can exceed
    // this grant when another linked session extended the cart. If the
    // reload fails, fall back to the incoming proof's expiry, which
    // never exceeds the grant as issued. If reissue crosses the grant
    // expiry the committed cart is returned without a new proof instead
    // of surfacing the committed change as a 503; the existing proof and
    // cookie govern until they expire, and retries replay by
    // operation id.
    const liveGrant = await loadLiveGrantOperations(client, principal);
    const proofGrantExpiry = liveGrant
      ? Date.parse(liveGrant.grantExpiresAt) < Date.parse(result.cart.expiresAt)
        ? liveGrant.grantExpiresAt
        : result.cart.expiresAt
      : principal.expiresAt;
    let proof: string | null = null;
    try {
      proof = issueCartSessionProof(
        {
          allowedOperations: principal.allowedOperations,
          cartId: principal.cartId,
          grantId: principal.grantId,
          grantExpiresAt: proofGrantExpiry,
          merchantId: context.merchant.id,
          principalId: principal.principalId,
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
    // The cookie must not outlive the proof it carries: cap its
    // lifetime at the earlier of the grant expiry the proof was
    // capped to and the cart expiry.
    const cookieExpiry =
      Date.parse(proofGrantExpiry) < Date.parse(result.cart.expiresAt)
        ? proofGrantExpiry
        : result.cart.expiresAt;
    const maxAge = cartSessionCookieMaxAge(cookieExpiry);
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
