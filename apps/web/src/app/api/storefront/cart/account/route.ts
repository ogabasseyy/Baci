import type { NextRequest } from 'next/server';
import { getCustomerCart, linkCartToCustomer } from '@/lib/cart/account-link';
import { resolveAccountCartRequest } from '@/lib/cart/account-request';
import { getCartProofEnvironment } from '@/lib/cart/cart-runtime-env';
import {
  checkCartQuota,
  createAnonMerchantFeatureLookup,
  readCartJsonBody,
} from '@/lib/cart/request-context';
import {
  cartErrorResponse,
  cartJsonResponse,
  setCartSessionCookie,
} from '@/lib/cart/response';
import {
  cartSessionCookieMaxAge,
  issueCartSessionProof,
  verifyCartSessionProof,
} from '@/lib/cart/session-proof';
import { checkCsrfProtection } from '@/lib/csrf';
import { getCurrentSlugForAlias } from '@/lib/slug-alias-cache';
import { createAnonClient } from '@/lib/supabase/anon';
import { cartAccountLinkRequestSchema } from '@/schemas/cart-account';

function context(request: NextRequest) {
  return resolveAccountCartRequest(request, {
    merchant: {
      resolveAlias: getCurrentSlugForAlias,
      rpcClient: createAnonClient(),
      loadMerchantFeatures: createAnonMerchantFeatureLookup(createAnonClient()),
    },
    requireScope: 'any',
    wrongScopeError: 'not_found',
    verify: (proof) =>
      verifyCartSessionProof(proof, { environment: getCartProofEnvironment() }),
  });
}
/** Authenticated read only; guest checkout never requires this endpoint. */
export async function GET(request: NextRequest): Promise<Response> {
  try {
    const resolved = await context(request);
    if (!resolved.ok) return cartErrorResponse(resolved.error);
    if (
      !(
        await checkCartQuota({
          operation: 'snapshot',
          merchantId: resolved.principal.merchantId,
          subject: resolved.customer.userId,
        })
      ).allowed
    )
      return cartErrorResponse('quota_exceeded');
    const result = await getCustomerCart(resolved.principal, resolved.customer);
    return result.ok
      ? cartJsonResponse({ cart: result.cart })
      : cartErrorResponse(result.code);
  } catch {
    return cartErrorResponse('temporarily_unavailable');
  }
}
/** Explicit account choice, never inferred from email or a save-details checkbox. */
export async function POST(request: NextRequest): Promise<Response> {
  try {
    // Authenticate the account context before consuming or validating
    // any body: unauthenticated payloads must not drive route work.
    const resolved = await context(request);
    if (!resolved.ok) return cartErrorResponse(resolved.error);
    if (!(await checkCsrfProtection(request)).valid)
      return cartErrorResponse('forbidden');
    const body = await readCartJsonBody(request);
    if (!body.ok) return cartErrorResponse('invalid_request');
    const parsed = cartAccountLinkRequestSchema.safeParse(body.body);
    if (!parsed.success) return cartErrorResponse('invalid_request');
    if (
      !(
        await checkCartQuota({
          operation: 'account_link',
          merchantId: resolved.principal.merchantId,
          subject: resolved.customer.userId,
        })
      ).allowed
    )
      return cartErrorResponse('quota_exceeded');
    const result = await linkCartToCustomer(
      resolved.principal,
      resolved.customer,
      parsed.data,
      {
        environment: getCartProofEnvironment(),
        destination: { type: 'web' },
      }
    );
    if (!result.ok) return cartErrorResponse(result.code);
    if (!result.grantId) return cartErrorResponse('temporarily_unavailable');
    const proof = issueCartSessionProof(
      {
        merchantId: resolved.principal.merchantId,
        principalId: result.principalId,
        cartId: result.cart.cartId,
        grantId: result.grantId,
        scope: 'session',
        grantExpiresAt: result.cart.expiresAt,
      },
      { environment: getCartProofEnvironment() }
    );
    const response = cartJsonResponse({
      cart: result.cart,
      proof,
      linkedUserId: resolved.customer.userId,
      operationId: result.operationId,
      replayed: result.replayed,
      warnings: result.warnings,
    });
    // The proof is capped at the cart expiry; the cookie must not
    // outlive it (a non-positive lifetime would delete the cookie, so
    // omit it and let the body proof govern until it expires).
    const cookieMaxAge = cartSessionCookieMaxAge(result.cart.expiresAt);
    if (cookieMaxAge > 0) {
      setCartSessionCookie(response, resolved.merchant.id, proof, cookieMaxAge);
    }
    return response;
  } catch {
    return cartErrorResponse('temporarily_unavailable');
  }
}
