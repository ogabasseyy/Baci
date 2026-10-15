import { randomUUID } from 'node:crypto';
import type { NextRequest } from 'next/server';
import { getCartProofEnvironment } from '@/lib/cart/cart-runtime-env';
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
import {
  CART_BOOTSTRAP_PROOF_TTL_SECONDS,
  CartSessionConfigError,
  issueCartSessionProof,
} from '@/lib/cart/session-proof';
import { checkCsrfProtection } from '@/lib/csrf';
import { getClientIdentifier } from '@/lib/rate-limit';
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
      subject: getClientIdentifier(request),
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
        proof,
      },
      { status: 201 }
    );
    setCartSessionCookie(
      response,
      merchant.merchant.id,
      proof,
      CART_BOOTSTRAP_PROOF_TTL_SECONDS
    );
    return response;
  } catch (error) {
    console.error('Unexpected error in POST /api/storefront/cart/bootstrap:', {
      message: error instanceof Error ? error.message : 'unknown',
    });
    return cartErrorResponse('temporarily_unavailable');
  }
}
