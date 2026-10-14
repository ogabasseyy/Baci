import { describe, expect, it, vi } from 'vitest';

import {
  readCartJsonBody,
  readCartProofFromRequest,
  resolveCartRequestContext,
} from './request-context';

import type { CartSessionVerification } from './session-proof';

import { CartSessionConfigError } from './session-proof';

const MERCHANT_ID = '11111111-1111-4111-8111-111111111111';

const OTHER_MERCHANT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

function merchantRow(overrides: Record<string, unknown> = {}) {
  return {
    business_name: 'Oga Store',
    custom_domain: null,
    id: MERCHANT_ID,
    is_published: true,
    slug: 'ogabassey',
    ...overrides,
  };
}

function rpcClientReturning(rows: unknown, error: unknown = null) {
  return {
    rpc: vi.fn(async () => ({ data: rows, error })),
  };
}

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
      merchantId: MERCHANT_ID,
      principalId: 'guest-a1',
      ...overrides,
    },
  };
}

function bootstrapVerification(
  overrides: Partial<
    Extract<CartSessionVerification, { ok: true }>['session']
  > = {}
): CartSessionVerification {
  return sessionVerification({
    allowedOperations: [],
    cartId: null,
    grantId: null,
    ...overrides,
  });
}

describe('readCartJsonBody', () => {
  it('parses JSON bodies and treats empty bodies as empty objects', async () => {
    const withBody = new Request('https://usebaci.com/api/x', {
      body: JSON.stringify({ merchantSlug: 'ogabassey' }),
      method: 'POST',
    });
    expect(await readCartJsonBody(withBody)).toEqual({
      body: { merchantSlug: 'ogabassey' },
      ok: true,
    });

    const empty = new Request('https://usebaci.com/api/x', { method: 'POST' });
    expect(await readCartJsonBody(empty)).toEqual({ body: {}, ok: true });
  });

  it('rejects malformed JSON without throwing', async () => {
    const request = new Request('https://usebaci.com/api/x', {
      body: '{"merchantSlug":',
      method: 'POST',
    });

    expect(await readCartJsonBody(request)).toEqual({ ok: false });
  });
});

describe('readCartProofFromRequest', () => {
  it('reads the merchant-namespaced cookie by default', () => {
    const request = new Request('https://usebaci.com/api/x', {
      headers: { cookie: 'baci-cart-ogabassey=cp1.cookie.signature' },
    });

    expect(readCartProofFromRequest(request, 'baci-cart-ogabassey')).toBe(
      'cp1.cookie.signature'
    );
  });

  it('prefers a native cart Bearer proof over cookies', () => {
    const request = new Request('https://usebaci.com/api/x', {
      headers: {
        authorization: 'Bearer cp1.native.signature',
        cookie: 'baci-cart-ogabassey=cp1.cookie.signature',
      },
    });

    expect(readCartProofFromRequest(request, 'baci-cart-ogabassey')).toBe(
      'cp1.native.signature'
    );
  });

  it('ignores non-cart Bearer [REDACTED] and falls back to cookies', () => {
    const request = new Request('https://usebaci.com/api/x', {
      headers: {
        authorization: 'Bearer eyJhbGciOiJIUzI1NiJ9.supabase-jwt',
        cookie: 'baci-cart-ogabassey=cp1.cookie.signature',
      },
    });

    expect(readCartProofFromRequest(request, 'baci-cart-ogabassey')).toBe(
      'cp1.cookie.signature'
    );
  });

  it('returns null when neither transport carries a cart proof', () => {
    const request = new Request('https://usebaci.com/api/x', {
      headers: { authorization: 'Bearer eyJhbGciOiJIUzI1NiJ9.other' },
    });

    expect(readCartProofFromRequest(request, 'baci-cart-ogabassey')).toBeNull();
  });
});

describe('resolveCartRequestContext', () => {
  function merchantDeps() {
    return {
      resolveAlias: async () => null,
      rootDomain: 'usebaci.com',
      rpcClient: rpcClientReturning([merchantRow()]),
    };
  }

  it('builds merchant plus principal from a trusted host and cookie', async () => {
    const request = new Request('https://ogabassey.usebaci.com/api/x', {
      headers: {
        cookie: 'baci-cart-ogabassey=cp1.proof.signature',
        'x-merchant-slug': 'ogabassey',
      },
    });

    const result = await resolveCartRequestContext(request, {
      merchant: merchantDeps(),
      requireScope: 'session',
      verify: async () => sessionVerification(),
      wrongScopeError: 'not_found',
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.merchant).toEqual({
        customDomain: null,
        id: MERCHANT_ID,
        slug: 'ogabassey',
      });
      expect(result.principal.scope).toBe('session');
    }
  });

  it('rejects a proof bound to a different merchant than the host', async () => {
    const request = new Request('https://ogabassey.usebaci.com/api/x', {
      headers: {
        cookie: 'baci-cart-ogabassey=cp1.proof.signature',
        'x-merchant-slug': 'ogabassey',
      },
    });

    const result = await resolveCartRequestContext(request, {
      merchant: merchantDeps(),
      requireScope: 'session',
      verify: async () =>
        sessionVerification({ merchantId: OTHER_MERCHANT_ID }),
      wrongScopeError: 'not_found',
    });

    expect(result).toEqual({ error: 'merchant_mismatch', ok: false });
  });

  it('reports expired proofs distinctly from missing ones', async () => {
    const request = new Request('https://ogabassey.usebaci.com/api/x', {
      headers: {
        cookie: 'baci-cart-ogabassey=cp1.stale.signature',
        'x-merchant-slug': 'ogabassey',
      },
    });

    const result = await resolveCartRequestContext(request, {
      merchant: merchantDeps(),
      requireScope: 'session',
      verify: async () => ({ error: 'expired_proof', ok: false }),
      wrongScopeError: 'not_found',
    });

    expect(result).toEqual({ error: 'expired_proof', ok: false });
  });

  it('applies the route scope rule when a bootstrap proof reaches a session route', async () => {
    const request = new Request('https://ogabassey.usebaci.com/api/x', {
      headers: {
        cookie: 'baci-cart-ogabassey=cp1.bootstrap.signature',
        'x-merchant-slug': 'ogabassey',
      },
    });

    const result = await resolveCartRequestContext(request, {
      merchant: merchantDeps(),
      requireScope: 'session',
      verify: async () => bootstrapVerification(),
      wrongScopeError: 'not_found',
    });

    expect(result).toEqual({ error: 'not_found', ok: false });
  });

  it('accepts either scope when a route allows both', async () => {
    const request = new Request('https://ogabassey.usebaci.com/api/x', {
      headers: {
        cookie: 'baci-cart-ogabassey=cp1.bootstrap.signature',
        'x-merchant-slug': 'ogabassey',
      },
    });

    const bootstrapResult = await resolveCartRequestContext(request, {
      merchant: merchantDeps(),
      requireScope: 'any',
      verify: async () => bootstrapVerification(),
      wrongScopeError: 'not_found',
    });
    expect(bootstrapResult.ok).toBe(true);

    const sessionResult = await resolveCartRequestContext(request, {
      merchant: merchantDeps(),
      requireScope: 'any',
      verify: async () => sessionVerification(),
      wrongScopeError: 'not_found',
    });
    expect(sessionResult.ok).toBe(true);
  });

  it('fails closed when proof configuration is missing', async () => {
    const request = new Request('https://ogabassey.usebaci.com/api/x', {
      headers: {
        cookie: 'baci-cart-ogabassey=cp1.proof.signature',
        'x-merchant-slug': 'ogabassey',
      },
    });

    const result = await resolveCartRequestContext(request, {
      merchant: merchantDeps(),
      requireScope: 'session',
      verify: async () => {
        throw new CartSessionConfigError();
      },
      wrongScopeError: 'not_found',
    });

    expect(result).toEqual({ error: 'temporarily_unavailable', ok: false });
  });
});
