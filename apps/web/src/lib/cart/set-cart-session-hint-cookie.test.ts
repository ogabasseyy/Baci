import { NextResponse } from 'next/server';
import { describe, expect, it } from 'vitest';
import { CART_SESSION_HINT_TTL_SECONDS } from './cart-session-hint-constants';
import { setCartSessionHintCookie } from './set-cart-session-hint-cookie';

describe('setCartSessionHintCookie', () => {
  it('applies documented active and empty TTL defaults per merchant', () => {
    const activeRes = new NextResponse(null, { status: 204 });
    setCartSessionHintCookie(activeRes, 'Merchant-A', '1');
    const activeHeader = activeRes.headers.get('set-cookie') ?? '';
    expect(activeHeader).toContain('baci-cart-hint-merchant-a=1');
    expect(activeHeader).toContain(
      `Max-Age=${CART_SESSION_HINT_TTL_SECONDS.active}`
    );

    const emptyRes = new NextResponse(null, { status: 204 });
    setCartSessionHintCookie(emptyRes, 'Merchant-A', '0');
    const emptyHeader = emptyRes.headers.get('set-cookie') ?? '';
    expect(emptyHeader).toContain('baci-cart-hint-merchant-a=0');
    expect(emptyHeader).toContain(
      `Max-Age=${CART_SESSION_HINT_TTL_SECONDS.empty}`
    );
  });
});
