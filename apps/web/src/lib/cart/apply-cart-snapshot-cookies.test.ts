import { describe, expect, it } from 'vitest';
import { applyCartSnapshotCookies } from './apply-cart-snapshot-cookies';
import { cartJsonResponse } from './response';

describe('applyCartSnapshotCookies', () => {
  it('sets both session and active hint cookies when proof is valid and cart has lines', () => {
    const response = cartJsonResponse({ ok: true });
    applyCartSnapshotCookies(response, {
      merchantId: 'ogabassey',
      cart: { state: 'active', lines: [{}] },
      proof: 'cp1.proof.signature',
      cookieMaxAge: 900,
    });

    const setCookie = response.headers.get('set-cookie') ?? '';
    expect(setCookie).toContain('baci-cart-ogabassey=cp1.proof.signature');
    expect(setCookie).toContain('baci-cart-hint-ogabassey=1');
  });

  it('sets hint=0 without duplicating headers when cart is empty or proof is omitted', () => {
    const response = cartJsonResponse({ ok: true });
    applyCartSnapshotCookies(response, {
      merchantId: 'ogabassey',
      cart: { state: 'active', lines: [] },
      proof: null,
      cookieMaxAge: 0,
    });

    const setCookie = response.headers.get('set-cookie') ?? '';
    expect(setCookie).not.toContain('baci-cart-ogabassey=');
    expect(setCookie).toContain('baci-cart-hint-ogabassey=0');
  });
});
