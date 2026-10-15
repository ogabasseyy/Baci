import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  requestCarriesSharedCartSessionProof,
  verifySharedCartOrderProof,
} from './order-proof';
import { cartSessionCookieName } from './principal';
import { issueCartSessionProof } from './session-proof';

const SECRET = 'test-cart-session-secret-with-enough-length-001';
const MERCHANT_ID = '11111111-1111-4111-8111-111111111111';
const CART_ID = '22222222-2222-4222-8222-222222222222';
const GRANT_ID = '33333333-3333-4333-8333-333333333333';

function proofFor(cartId: string, principalId = 'guest-principal-001') {
  return issueCartSessionProof(
    {
      cartId,
      grantId: GRANT_ID,
      merchantId: MERCHANT_ID,
      principalId,
      scope: 'session',
    },
    { environment: 'test', secret: SECRET }
  );
}

describe('verifySharedCartOrderProof', () => {
  beforeEach(() => {
    process.env.CART_SESSION_SECRET = SECRET;
    process.env.CART_PROOF_ENVIRONMENT = 'test';
  });
  afterEach(() => {
    delete process.env.CART_SESSION_SECRET;
    delete process.env.CART_PROOF_ENVIRONMENT;
  });

  it('accepts a native header proof for the submitted cart', () => {
    const request = new Request('http://localhost/api/orders', {
      headers: { 'x-cart-proof': proofFor(CART_ID) },
    });
    expect(
      verifySharedCartOrderProof(request, {
        cartId: CART_ID,
        merchantId: MERCHANT_ID,
      })
    ).toEqual({ ok: true, principalId: 'guest-principal-001' });
  });

  it('accepts the merchant session cookie proof for browsers', () => {
    const request = new Request('http://localhost/api/orders', {
      headers: {
        cookie: `${cartSessionCookieName(MERCHANT_ID)}=${proofFor(CART_ID)}`,
      },
    });
    expect(
      verifySharedCartOrderProof(request, {
        cartId: CART_ID,
        merchantId: MERCHANT_ID,
      })
    ).toEqual({ ok: true, principalId: 'guest-principal-001' });
  });

  it('rejects a proof minted for another cart or merchant', () => {
    const foreign = new Request('http://localhost/api/orders', {
      headers: {
        'x-cart-proof': proofFor('99999999-9999-4999-8999-999999999999'),
      },
    });
    expect(
      verifySharedCartOrderProof(foreign, {
        cartId: CART_ID,
        merchantId: MERCHANT_ID,
      })
    ).toEqual({ ok: false });

    const request = new Request('http://localhost/api/orders', {
      headers: { 'x-cart-proof': proofFor(CART_ID) },
    });
    expect(
      verifySharedCartOrderProof(request, {
        cartId: CART_ID,
        merchantId: '99999999-9999-4999-8999-999999999999',
      })
    ).toEqual({ ok: false });
  });

  it('detects cart authority from any candidate when another is stale', () => {
    const request = new Request('http://localhost/api/orders', {
      headers: {
        cookie: `${cartSessionCookieName(MERCHANT_ID)}=${proofFor(CART_ID)}`,
        'x-cart-proof': 'cp1.stale.stale',
      },
    });
    expect(requestCarriesSharedCartSessionProof(request, MERCHANT_ID)).toBe(
      true
    );
    const staleOnly = new Request('http://localhost/api/orders', {
      headers: { 'x-cart-proof': 'cp1.stale.stale' },
    });
    expect(requestCarriesSharedCartSessionProof(staleOnly, MERCHANT_ID)).toBe(
      false
    );
    expect(
      requestCarriesSharedCartSessionProof(
        new Request('http://localhost/api/orders'),
        MERCHANT_ID
      )
    ).toBe(false);
  });

  it('rejects missing and forged proofs', () => {
    expect(
      verifySharedCartOrderProof(new Request('http://localhost/api/orders'), {
        cartId: CART_ID,
        merchantId: MERCHANT_ID,
      })
    ).toEqual({ ok: false });

    const forged = new Request('http://localhost/api/orders', {
      headers: { 'x-cart-proof': 'cp1.forged.forged' },
    });
    expect(
      verifySharedCartOrderProof(forged, {
        cartId: CART_ID,
        merchantId: MERCHANT_ID,
      })
    ).toEqual({ ok: false });
  });
});
