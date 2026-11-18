import type { NextResponse } from 'next/server';
import { CART_SESSION_HINT_TTL_SECONDS } from './cart-session-hint-constants';
import { cartSessionHintCookieName } from './cart-session-hint-cookie-name';

/**
 * Non-HttpOnly cart hint cookie (`'1'` | `'0'`), namespaced per merchant
 * so the client knows whether a server cart session exists before firing
 * `GET /api/storefront/cart`.
 */
export function setCartSessionHintCookie(
  response: NextResponse,
  merchantId: string,
  value: '1' | '0',
  maxAgeSeconds?: number
): void {
  const defaultMaxAge =
    value === '0'
      ? CART_SESSION_HINT_TTL_SECONDS.empty
      : CART_SESSION_HINT_TTL_SECONDS.active;
  response.cookies.set(cartSessionHintCookieName(merchantId), value, {
    httpOnly: false,
    maxAge: maxAgeSeconds ?? defaultMaxAge,
    path: '/',
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
  });
}
