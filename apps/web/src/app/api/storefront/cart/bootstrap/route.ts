import { randomUUID } from 'node:crypto';
import type { NextRequest } from 'next/server';
import { requestUsesSharedPlatformHost } from '@/lib/cart/body-proof-host';
import { getCartProofEnvironment } from '@/lib/cart/cart-runtime-env';
import {
  cartSessionCookieName,
  readCookieFromRequest,
} from '@/lib/cart/principal';
import {
  checkCartQuota,
  createAnonMerchantFeatureLookup,
  readCartJsonBody,
  resolveCartMerchant,
} from '@/lib/cart/request-context';
import {
  cartErrorResponse,
  cartJsonResponse,
  setCartSessionCookie,
} from '@/lib/cart/response';
import { createCartScopedClient } from '@/lib/cart/scoped-client';
import { getCart } from '@/lib/cart/service';
import {
  CART_BOOTSTRAP_PROOF_TTL_SECONDS,
  CartSessionConfigError,
  issueCartSessionProof,
  verifyCartSessionProof,
} from '@/lib/cart/session-proof';
import { checkCsrfProtection } from '@/lib/csrf';
import { getTrustedClientIdentifier } from '@/lib/rate-limit';
import { getCurrentSlugForAlias } from '@/lib/slug-alias-cache';
import { createAnonClient } from '@/lib/supabase/anon';
import { cartBootstrapRequestSchema } from '@/schemas/cart';

/**
 * POST /api/storefront/cart/bootstrap
 *
 * Establishes bounded anonymous retry identity for a guest: a
 * short-lived bootstrap proof for exactly one merchant. Creates no
 * cart, no account and no auth session — the follow-up lazy create
 * consumes the proof exactly once per operation id.
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
    const parsedBody = cartBootstrapRequestSchema.safeParse(rawBody.body);
    if (!parsedBody.success) {
      return cartErrorResponse('invalid_request');
    }

    const merchant = await resolveCartMerchant(request, {
      bodyHint: parsedBody.data.merchantSlug ?? null,
      resolveAlias: getCurrentSlugForAlias,
      rpcClient: createAnonClient(),
      loadMerchantFeatures: createAnonMerchantFeatureLookup(createAnonClient()),
    });
    if (!merchant.ok) {
      return cartErrorResponse(merchant.error);
    }

    const quota = await checkCartQuota({
      merchantId: merchant.merchant.id,
      operation: 'bootstrap',
      subject: getTrustedClientIdentifier(request),
    });
    if (!quota.allowed) {
      return cartErrorResponse('quota_exceeded');
    }

    let proof: string;
    try {
      proof = issueCartSessionProof(
        {
          cartId: null,
          grantId: null,
          merchantId: merchant.merchant.id,
          principalId: randomUUID(),
          scope: 'bootstrap',
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
        expiresAt: new Date(
          Date.now() + CART_BOOTSTRAP_PROOF_TTL_SECONDS * 1000
        ).toISOString(),
        merchant: {
          id: merchant.merchant.id,
          slug: merchant.merchant.slug,
        },
        // The proof leaves in the body only on shared platform hosts
        // (the native/programmatic surface, which cannot rely on
        // cookies). Storefront-host web callers receive it exclusively
        // via the httpOnly cookie below, so response-reading script
        // cannot lift a replayable credential and upgrade it into a
        // session proof through the create route.
        ...(requestUsesSharedPlatformHost(request) ? { proof } : {}),
      },
      { status: 201 }
    );
    // Never downgrade a live session cookie to a cart-less bootstrap
    // proof: a stale tab re-provisioning would make the shopper's live
    // cart look lost in this browser.
    const existingProof = readCookieFromRequest(
      request,
      cartSessionCookieName(merchant.merchant.id)
    );
    let hasLiveSessionCookie = false;
    if (existingProof) {
      const verified = verifyCartSessionProof(existingProof, {
        environment: getCartProofEnvironment(),
      });
      hasLiveSessionCookie =
        verified.ok &&
        verified.session.merchantId === merchant.merchant.id &&
        verified.session.cartId !== null;
      if (hasLiveSessionCookie && verified.ok) {
        // Preserve a usable live cart, but let a completed/retired cart
        // relinquish its cookie so subsequent writes can start afresh.
        try {
          const principal = { ...verified.session, scope: 'session' as const };
          const current = await getCart({
            principal,
            client: createCartScopedClient(principal),
          });
          if (current.ok)
            hasLiveSessionCookie =
              current.cart.state === 'active' ||
              current.cart.state === 'checkout';
          else if (current.code === 'expired' || current.code === 'not_found')
            hasLiveSessionCookie = false;
        } catch {
          /* An indeterminate read must not discard a potentially live cart. */
        }
      }
    }
    if (!hasLiveSessionCookie) {
      setCartSessionCookie(
        response,
        merchant.merchant.id,
        proof,
        CART_BOOTSTRAP_PROOF_TTL_SECONDS
      );
    }
    return response;
  } catch (error) {
    console.error('Unexpected error in POST /api/storefront/cart/bootstrap:', {
      message: error instanceof Error ? error.message : 'unknown',
    });
    return cartErrorResponse('temporarily_unavailable');
  }
}
