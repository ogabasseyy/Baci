import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  requestCarriesSharedCartSessionProof,
  requestPresentsCartProofMaterial,
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

  it('does not treat a proof for another merchant as authority for this one', () => {
    // Proofs are cryptographically merchant-bound: a session proof for
    // merchant A presented on an order naming merchant B verifies for
    // neither the binding check nor the carries-authority check, so the
    // caller is an ordinary legacy guest for B and gains no A-cart
    // authority by naming B.
    const request = new Request('http://localhost/api/orders', {
      headers: { 'x-cart-proof': proofFor(CART_ID) },
    });
    const otherMerchant = '99999999-9999-4999-8999-999999999999';
    expect(requestCarriesSharedCartSessionProof(request, otherMerchant)).toBe(
      false
    );
    expect(
      verifySharedCartOrderProof(request, {
        cartId: CART_ID,
        merchantId: otherMerchant,
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

  it('detects presented cart material even when it no longer verifies', () => {
    const stale = new Request('http://localhost/api/orders', {
      headers: { 'x-cart-proof': 'cp1.stale.stale' },
    });
    expect(requestCarriesSharedCartSessionProof(stale, MERCHANT_ID)).toBe(
      false
    );
    expect(requestPresentsCartProofMaterial(stale, MERCHANT_ID)).toBe(true);
    const cookieStale = new Request('http://localhost/api/orders', {
      headers: {
        cookie: `${cartSessionCookieName(MERCHANT_ID)}=cp1.stale.stale`,
      },
    });
    expect(requestPresentsCartProofMaterial(cookieStale, MERCHANT_ID)).toBe(
      true
    );
    // Non-cart credentials (e.g. account JWTs) are not cart material.
    const accountOnly = new Request('http://localhost/api/orders', {
      headers: { authorization: 'Bearer [REDACTED]' },
    });
    expect(requestPresentsCartProofMaterial(accountOnly, MERCHANT_ID)).toBe(
      false
    );
    expect(
      requestPresentsCartProofMaterial(
        new Request('http://localhost/api/orders'),
        MERCHANT_ID
      )
    ).toBe(false);
  });

  it("detects cart material in another merchant's session cookie without authorizing it", () => {
    const otherMerchant = '77777777-7777-4777-8777-777777777777';
    const crossMerchant = new Request('http://localhost/api/orders', {
      headers: {
        cookie: `${cartSessionCookieName(otherMerchant)}=cp1.stale.stale`,
      },
    });
    // Presented material for any merchant blocks the legacy fall-through
    // when the body names this merchant...
    expect(requestPresentsCartProofMaterial(crossMerchant, MERCHANT_ID)).toBe(
      true
    );
    // ...but the proof's inner merchant binding, not the cookie name,
    // decides authorization: it never authorizes the merchant named
    // only by the cookie when the proof was minted for another.
    const validCross = new Request('http://localhost/api/orders', {
      headers: {
        cookie: `${cartSessionCookieName(otherMerchant)}=${proofFor(CART_ID)}`,
      },
    });
    expect(
      requestCarriesSharedCartSessionProof(validCross, otherMerchant)
    ).toBe(false);
    expect(
      verifySharedCartOrderProof(validCross, {
        cartId: CART_ID,
        merchantId: otherMerchant,
      })
    ).toEqual({ ok: false });
  });

  it('accepts a valid cookie proof when the header proof is stale', () => {
    const request = new Request('http://localhost/api/orders', {
      headers: {
        cookie: `${cartSessionCookieName(MERCHANT_ID)}=${proofFor(CART_ID)}`,
        'x-cart-proof': proofFor('99999999-9999-4999-8999-999999999999'),
      },
    });
    expect(
      verifySharedCartOrderProof(request, {
        cartId: CART_ID,
        merchantId: MERCHANT_ID,
      })
    ).toEqual({ ok: true, principalId: 'guest-principal-001' });
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
