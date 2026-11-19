import type { NextResponse } from 'next/server';
import { setCartSessionCookie } from './response';
import { setCartSessionHintCookie } from './set-cart-session-hint-cookie';

/**
 * Attaches the session-proof cookie (when a proof with positive lifetime was
 * issued) and the matching `'1'`/`'0'` cart hint cookie for a cart snapshot.
 */
export function applyCartSnapshotCookies(
  response: NextResponse,
  params: {
    merchantId: string;
    cart: { state: string; lines: readonly unknown[] };
    proof: string | null;
    cookieMaxAge: number;
  }
): void {
  const hintValue: '1' | '0' =
    params.cart.state === 'active' && params.cart.lines.length > 0 ? '1' : '0';
  if (params.proof && params.cookieMaxAge > 0) {
    setCartSessionCookie(
      response,
      params.merchantId,
      params.proof,
      params.cookieMaxAge,
      hintValue
    );
  } else {
    setCartSessionHintCookie(response, params.merchantId, hintValue);
  }
}
