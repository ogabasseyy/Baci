import type { CartErrorCode } from '@baci/shared/cart';
import { NextResponse } from 'next/server';
import { safeCartErrorMessage } from './mutation-errors';
import { cartSessionCookieName } from './principal';

/**
 * Cart responses are private per-guest state. They must never sit in a
 * shared cache, even when two stores share one origin.
 */
export const CART_PRIVATE_CACHE_CONTROL = 'private, no-store';

/** Optional browser discovery: no cookie means no session, never a public cart. */
export function emptyCartProbeResponse(): NextResponse {
  return new NextResponse(null, {
    status: 204,
    headers: { 'Cache-Control': CART_PRIVATE_CACHE_CONTROL },
  });
}

export type CartRouteErrorCode =
  | CartErrorCode
  | 'invalid_request'
  | 'missing_proof'
  | 'invalid_proof'
  | 'expired_proof'
  | 'merchant_unresolved'
  | 'merchant_mismatch'
  | 'quota_exceeded';

const ROUTE_STATUS: Record<CartRouteErrorCode, number> = {
  cart_locked: 409,
  expired: 404,
  expired_proof: 401,
  forbidden: 403,
  handoff_consumed: 404,
  idempotency_conflict: 409,
  invalid_item: 400,
  invalid_proof: 401,
  invalid_request: 400,
  merchant_mismatch: 403,
  merge_conflict: 409,
  merchant_unavailable: 403,
  merchant_unresolved: 404,
  missing_proof: 401,
  not_found: 404,
  quota_exceeded: 429,
  rate_limited: 429,
  refresh_required: 409,
  temporarily_unavailable: 503,
  too_many_lines: 400,
  unauthorized: 401,
  version_conflict: 409,
};

const ROUTE_MESSAGES: Record<
  Exclude<CartRouteErrorCode, CartErrorCode>,
  string
> = {
  expired_proof: 'Your cart session ended. Reconnect to keep shopping.',
  invalid_proof: 'Your cart session is not valid here. Reconnect to continue.',
  invalid_request: 'This cart request was malformed.',
  merchant_mismatch: 'This cart session belongs to a different store.',
  merchant_unresolved: 'We could not find this store.',
  missing_proof: 'Connect to the cart before making changes.',
  quota_exceeded: 'Too many cart requests. Wait a moment and try again.',
};

function routeErrorMessage(code: CartRouteErrorCode): string {
  if (code in ROUTE_MESSAGES) {
    return ROUTE_MESSAGES[code as keyof typeof ROUTE_MESSAGES];
  }
  return safeCartErrorMessage(code as CartErrorCode);
}

/** Successful cart payload. Always private and non-stored. */
export function cartJsonResponse(
  data: unknown,
  init: { status?: number } = {}
): NextResponse {
  return NextResponse.json(data, {
    headers: { 'Cache-Control': CART_PRIVATE_CACHE_CONTROL },
    status: init.status ?? 200,
  });
}

/**
 * Typed cart failure. Temporary outages map to 503, separately from
 * 404 not-found/expiry, so clients never mistake an outage for an
 * empty cart.
 */
export function cartErrorResponse(
  code: CartRouteErrorCode,
  extra?: Record<string, unknown>
): NextResponse {
  return NextResponse.json(
    { ...extra, code, error: routeErrorMessage(code) },
    {
      headers: { 'Cache-Control': CART_PRIVATE_CACHE_CONTROL },
      status: ROUTE_STATUS[code],
    }
  );
}

/**
 * Host-only session cookie, namespaced per merchant so two stores on
 * one shared origin keep separate sessions. Native clients ignore the
 * cookie and carry the proof from the response body instead.
 */
export function setCartSessionCookie(
  response: NextResponse,
  merchantId: string,
  proof: string,
  maxAgeSeconds: number
): void {
  response.cookies.set(cartSessionCookieName(merchantId), proof, {
    httpOnly: true,
    maxAge: maxAgeSeconds,
    path: '/',
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
  });
}
