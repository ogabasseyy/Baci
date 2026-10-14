import { describe, expect, it } from 'vitest';
import { cartSessionCookieName, resolveCartPrincipal } from './principal';
import type { CartSessionVerification } from './session-proof';

const MERCHANT_A = {
  id: '11111111-1111-4111-8111-111111111111',
  slug: 'ogabassey',
};
const MERCHANT_B = {
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  slug: 'second-merchant',
};

function sessionVerification(
  overrides: Partial<
    Extract<CartSessionVerification, { ok: true }>['session']
  > = {}
): CartSessionVerification {
  return {
    ok: true,
    session: {
      allowedOperations: ['add', 'set_quantity', 'remove', 'clear'],
      cartId: '22222222-2222-4222-8222-222222222222',
      expiresAt: '2026-10-13T04:00:00Z',
      grantId: '33333333-3333-4333-8333-333333333333',
      merchantId: MERCHANT_A.id,
      principalId: 'guest-principal-001',
      ...overrides,
    },
  };
}

function requestWithCookie(cookieHeader: string | null): Request {
  return new Request('https://ogabassey.example.com/store', {
    headers: cookieHeader ? { cookie: cookieHeader } : {},
  });
}

describe('cartSessionCookieName', () => {
  it('namespaces the session cookie by stable merchant id', () => {
    expect(cartSessionCookieName(MERCHANT_A.id)).toBe(
      'baci-cart-11111111-1111-4111-8111-111111111111'
    );
    expect(cartSessionCookieName(MERCHANT_B.id)).toBe(
      'baci-cart-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    );
  });
});

describe('resolveCartPrincipal', () => {
  it('resolves a principal from a valid merchant-namespaced cookie', async () => {
    const result = await resolveCartPrincipal(
      requestWithCookie(
        'baci-cart-11111111-1111-4111-8111-111111111111=proof-a'
      ),
      {
        resolveMerchant: async () => MERCHANT_A,
        verify: async () => sessionVerification(),
      }
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.principal.merchantId).toBe(MERCHANT_A.id);
      expect(result.principal.cartId).toBe(
        '22222222-2222-4222-8222-222222222222'
      );
      expect(result.principal.scope).toBe('session');
    }
  });

  it('reads a different cookie per merchant on one shared host', async () => {
    const seen: string[] = [];
    const request = requestWithCookie(
      'baci-cart-11111111-1111-4111-8111-111111111111=proof-a; baci-cart-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa=proof-b'
    );

    await resolveCartPrincipal(request, {
      resolveMerchant: async () => MERCHANT_B,
      verify: async (proof) => {
        seen.push(proof);
        return sessionVerification({ merchantId: MERCHANT_B.id });
      },
    });

    expect(seen).toEqual(['proof-b']);
  });

  it('reports a missing proof when the merchant cookie is absent', async () => {
    const result = await resolveCartPrincipal(requestWithCookie(null), {
      resolveMerchant: async () => MERCHANT_A,
      verify: async () => sessionVerification(),
    });

    expect(result).toEqual({ error: 'missing_proof', ok: false });
  });

  it('reports an invalid proof without constructing authority', async () => {
    const result = await resolveCartPrincipal(
      requestWithCookie(
        'baci-cart-11111111-1111-4111-8111-111111111111=forged'
      ),
      {
        resolveMerchant: async () => MERCHANT_A,
        verify: async () => ({ error: 'invalid_proof', ok: false }),
      }
    );

    expect(result).toEqual({ error: 'invalid_proof', ok: false });
  });

  it('reports an expired proof without constructing authority', async () => {
    const result = await resolveCartPrincipal(
      requestWithCookie('baci-cart-11111111-1111-4111-8111-111111111111=stale'),
      {
        resolveMerchant: async () => MERCHANT_A,
        verify: async () => ({ error: 'expired_proof', ok: false }),
      }
    );

    expect(result).toEqual({ error: 'expired_proof', ok: false });
  });

  it('rejects a proof bound to a different merchant than the host', async () => {
    const result = await resolveCartPrincipal(
      requestWithCookie(
        'baci-cart-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa=proof-a'
      ),
      {
        resolveMerchant: async () => MERCHANT_B,
        verify: async () => sessionVerification({ merchantId: MERCHANT_A.id }),
      }
    );

    expect(result).toEqual({ error: 'merchant_mismatch', ok: false });
  });

  it('reports an unresolved merchant without reading body authority', async () => {
    const result = await resolveCartPrincipal(
      requestWithCookie(
        'baci-cart-11111111-1111-4111-8111-111111111111=proof-a'
      ),
      {
        resolveMerchant: async () => null,
        verify: async () => sessionVerification(),
      }
    );

    expect(result).toEqual({ error: 'merchant_unresolved', ok: false });
  });

  it('accepts a native Bearer proof through an injected proof reader', async () => {
    const request = new Request('https://ogabassey.example.com/store', {
      headers: { authorization: 'Bearer cp1.native-proof.signature' },
    });
    const result = await resolveCartPrincipal(request, {
      readProof: (candidate) => {
        const header = candidate.headers.get('authorization');
        const match = header?.match(/^\s*bearer\s+(.+?)\s*$/i);
        return match?.[1] ?? null;
      },
      resolveMerchant: async () => MERCHANT_A,
      verify: async (proof) =>
        proof === 'cp1.native-proof.signature'
          ? sessionVerification()
          : { error: 'invalid_proof', ok: false },
    });

    expect(result.ok).toBe(true);
  });

  it('keeps the merchant-namespaced cookie as the default proof source', async () => {
    const result = await resolveCartPrincipal(
      requestWithCookie(
        'baci-cart-11111111-1111-4111-8111-111111111111=proof-a'
      ),
      {
        resolveMerchant: async () => MERCHANT_A,
        verify: async (proof) =>
          proof === 'proof-a'
            ? sessionVerification()
            : { error: 'invalid_proof', ok: false },
      }
    );

    expect(result.ok).toBe(true);
  });
});
