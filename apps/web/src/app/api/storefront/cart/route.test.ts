import { describe, expect, it } from 'vitest';
import { issueCartSessionProof } from '@/lib/cart/session-proof';
import {
  bootstrapProof,
  CART_ID,
  cartCookie,
  GRANT_ID,
  getCart,
  MERCHANT,
  merchantRow,
  mocks,
  OTHER_MERCHANT,
  rawLine,
  rawState,
  sessionProof,
  TEST_SECRET,
} from './route.test-support';

describe('GET /api/storefront/cart', () => {
  it('returns no content for an explicit empty-session probe without creating a cart or cookie', async () => {
    const response = await getCart({
      headers: { 'x-baci-cart-probe': '1' },
    });
    expect(response.status).toBe(204);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(response.headers.get('set-cookie')).toBeNull();
    expect(await response.text()).toBe('');
    expect(mocks.capturedPrincipal).toBeNull();
  });

  it('still rejects invalid proofs on an empty-session probe', async () => {
    const response = await getCart({
      headers: {
        'x-baci-cart-probe': '1',
        cookie: cartCookie('cp1.invalid.invalid'),
      },
    });
    expect(response.status).toBe(401);
    expect((await response.json()).code).toBe('invalid_proof');
    expect(mocks.capturedPrincipal).toBeNull();
  });

  it('returns the authorized snapshot without setting cookies', async () => {
    mocks.cartPayload = {
      code: null,
      ok: true,
      replayed: false,
      state: rawState({ lines: [rawLine()] }),
    };

    const response = await getCart({
      headers: { cookie: cartCookie(sessionProof()) },
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(response.headers.get('set-cookie')).toBeNull();
    const payload = await response.json();
    expect(payload.cart.cartId).toBe(CART_ID);
    expect(payload.cart.lines).toHaveLength(1);
    expect(payload.cart.totalMinor).toBe(5000);
    expect(mocks.capturedPrincipal).toMatchObject({
      cartId: CART_ID,
      merchantId: MERCHANT.id,
      principalId: 'guest-a1',
      scope: 'session',
    });
  });

  it('accepts a native Bearer session proof', async () => {
    mocks.cartPayload = {
      code: null,
      ok: true,
      replayed: false,
      state: rawState(),
    };

    const response = await getCart({
      headers: { authorization: `Bearer ${sessionProof()}` },
    });

    expect(response.status).toBe(200);
    expect((await response.json()).cart.cartId).toBe(CART_ID);
  });

  it('reports a missing cart for bootstrap proofs instead of failing auth', async () => {
    const response = await getCart({
      headers: { cookie: cartCookie(bootstrapProof()) },
    });

    expect(response.status).toBe(404);
    expect((await response.json()).code).toBe('not_found');
    expect(mocks.capturedPrincipal).toBeNull();
  });

  it('rejects missing proofs and foreign merchants', async () => {
    const missing = await getCart({ headers: {} });
    expect(missing.status).toBe(401);
    expect((await missing.json()).code).toBe('missing_proof');

    const foreign = await getCart({
      headers: { cookie: cartCookie(sessionProof(OTHER_MERCHANT.id)) },
    });
    expect(foreign.status).toBe(403);
    expect((await foreign.json()).code).toBe('merchant_mismatch');
  });

  it('keeps two stores on one origin separate', async () => {
    mocks.merchantRows = [merchantRow(OTHER_MERCHANT)];
    mocks.cartPayload = {
      code: null,
      ok: true,
      replayed: false,
      state: rawState({ merchantId: OTHER_MERCHANT.id }),
    };
    const url =
      'https://api.usebaci.com/api/storefront/cart?merchantSlug=second-store';

    const collision = await getCart({
      headers: { cookie: cartCookie(sessionProof()) },
      noMerchantHeader: true,
      url,
    });
    expect(collision.status).toBe(401);
    expect((await collision.json()).code).toBe('missing_proof');

    const otherProof = issueCartSessionProof(
      {
        cartId: CART_ID,
        grantId: GRANT_ID,
        merchantId: OTHER_MERCHANT.id,
        principalId: 'guest-b1',
        scope: 'session',
      },
      { environment: 'test', secret: TEST_SECRET }
    );
    const separated = await getCart({
      headers: { cookie: cartCookie(otherProof, OTHER_MERCHANT.id) },
      noMerchantHeader: true,
      url,
    });
    expect(separated.status).toBe(200);
    expect(mocks.capturedPrincipal).toMatchObject({
      merchantId: OTHER_MERCHANT.id,
      principalId: 'guest-b1',
    });
  });

  it('maps outage and expiry distinctly', async () => {
    mocks.cartError = { message: 'fetch failed' };
    const outage = await getCart({
      headers: { cookie: cartCookie(sessionProof()) },
    });
    expect(outage.status).toBe(503);
    expect((await outage.json()).code).toBe('temporarily_unavailable');

    mocks.cartError = null;
    mocks.cartPayload = {
      code: 'expired',
      ok: false,
      replayed: false,
      state: null,
    };
    const expired = await getCart({
      headers: { cookie: cartCookie(sessionProof()) },
    });
    expect(expired.status).toBe(404);
    expect((await expired.json()).code).toBe('expired');
  });
});
