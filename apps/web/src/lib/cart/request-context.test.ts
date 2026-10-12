import { describe, expect, it, vi } from 'vitest';
import {
  __resetCartQuotaStoreForTesting,
  checkCartQuota,
  readCartJsonBody,
  readCartProofFromRequest,
  resolveCartMerchant,
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

describe('resolveCartMerchant', () => {
  it('trusts a proxy merchant header that matches the request host', async () => {
    const request = new Request('https://ogabassey.usebaci.com/api/x', {
      headers: { 'x-merchant-slug': 'ogabassey' },
    });
    const client = rpcClientReturning([merchantRow()]);

    const result = await resolveCartMerchant(request, {
      resolveAlias: async () => null,
      rootDomain: 'usebaci.com',
      rpcClient: client,
    });

    expect(result).toEqual({
      merchant: {
        customDomain: null,
        id: MERCHANT_ID,
        slug: 'ogabassey',
      },
      ok: true,
    });
    expect(client.rpc).toHaveBeenCalledWith(
      'resolve_storefront_auth_merchant',
      { p_identifier: 'ogabassey' }
    );
  });

  it('ignores a merchant header that does not match the request host', async () => {
    const request = new Request('https://attacker.usebaci.com/api/x', {
      headers: { 'x-merchant-slug': 'ogabassey' },
    });

    const result = await resolveCartMerchant(request, {
      resolveAlias: async () => null,
      rootDomain: 'usebaci.com',
      rpcClient: rpcClientReturning([merchantRow()]),
    });

    expect(result).toEqual({ error: 'merchant_unresolved', ok: false });
  });

  it('never consults forwarded-host context for merchant resolution', async () => {
    const request = new Request(
      'https://ogabassey.usebaci.com/api/x?merchantSlug=second-store',
      {
        headers: {
          'x-forwarded-host': 'victim.usebaci.com',
          'x-merchant-slug': 'ogabassey',
        },
      }
    );
    const client = rpcClientReturning([merchantRow()]);

    const result = await resolveCartMerchant(request, {
      resolveAlias: async () => null,
      rootDomain: 'usebaci.com',
      rpcClient: client,
    });

    expect(result.ok).toBe(true);
    expect(client.rpc).toHaveBeenCalledWith(
      'resolve_storefront_auth_merchant',
      { p_identifier: 'ogabassey' }
    );
  });

  it('trusts a custom-domain header matching the host, including www', async () => {
    for (const host of ['shop.example.com', 'www.shop.example.com']) {
      const request = new Request(`https://${host}/api/x`, {
        headers: { 'x-merchant-domain': 'shop.example.com' },
      });
      const client = rpcClientReturning([
        merchantRow({ custom_domain: 'shop.example.com' }),
      ]);

      const result = await resolveCartMerchant(request, {
        resolveAlias: async () => null,
        rootDomain: 'usebaci.com',
        rpcClient: client,
      });

      expect(result.ok).toBe(true);
      expect(client.rpc).toHaveBeenCalledWith(
        'resolve_storefront_auth_merchant',
        { p_identifier: 'shop.example.com' }
      );
    }
  });

  it('resolves a query hint on hosts without trusted headers', async () => {
    const request = new Request(
      'https://usebaci.com/api/storefront/cart?merchant_slug=ogabassey'
    );
    const client = rpcClientReturning([merchantRow()]);

    const result = await resolveCartMerchant(request, {
      resolveAlias: async () => null,
      rootDomain: 'usebaci.com',
      rpcClient: client,
    });

    expect(result.ok).toBe(true);
    expect(client.rpc).toHaveBeenCalledWith(
      'resolve_storefront_auth_merchant',
      { p_identifier: 'ogabassey' }
    );
  });

  it('resolves a body hint when no header or query identifies the store', async () => {
    const request = new Request('https://usebaci.com/api/storefront/cart');

    const result = await resolveCartMerchant(request, {
      bodyHint: 'ogabassey',
      resolveAlias: async () => null,
      rootDomain: 'usebaci.com',
      rpcClient: rpcClientReturning([merchantRow()]),
    });

    expect(result.ok).toBe(true);
  });

  it('prefers trusted headers over a conflicting client hint', async () => {
    const request = new Request(
      'https://ogabassey.usebaci.com/api/x?merchantSlug=second-store',
      { headers: { 'x-merchant-slug': 'ogabassey' } }
    );
    const client = rpcClientReturning([merchantRow()]);

    const result = await resolveCartMerchant(request, {
      resolveAlias: async () => null,
      rootDomain: 'usebaci.com',
      rpcClient: client,
    });

    expect(result.ok).toBe(true);
    expect(client.rpc).toHaveBeenCalledWith(
      'resolve_storefront_auth_merchant',
      { p_identifier: 'ogabassey' }
    );
  });

  it('follows retired slugs through the alias table', async () => {
    const request = new Request(
      'https://usebaci.com/api/storefront/cart?merchantSlug=old-slug'
    );
    const client = {
      rpc: vi.fn(async (_name: string, args: { p_identifier: string }) => ({
        data: args.p_identifier === 'ogabassey' ? [merchantRow()] : [],
        error: null,
      })),
    };

    const result = await resolveCartMerchant(request, {
      resolveAlias: async (slug) => (slug === 'old-slug' ? 'ogabassey' : null),
      rootDomain: 'usebaci.com',
      rpcClient: client,
    });

    expect(client.rpc).toHaveBeenCalledWith(
      'resolve_storefront_auth_merchant',
      { p_identifier: 'old-slug' }
    );
    expect(client.rpc).toHaveBeenCalledWith(
      'resolve_storefront_auth_merchant',
      { p_identifier: 'ogabassey' }
    );
    expect(result.ok).toBe(true);
  });

  it('rejects unpublished stores without revealing internals', async () => {
    const request = new Request(
      'https://usebaci.com/api/storefront/cart?merchantSlug=ogabassey'
    );

    const result = await resolveCartMerchant(request, {
      resolveAlias: async () => null,
      rootDomain: 'usebaci.com',
      rpcClient: rpcClientReturning([merchantRow({ is_published: false })]),
    });

    expect(result).toEqual({ error: 'merchant_unavailable', ok: false });
  });

  it('fails closed with a retryable code when merchant lookup errors', async () => {
    const request = new Request(
      'https://usebaci.com/api/storefront/cart?merchantSlug=ogabassey'
    );

    const result = await resolveCartMerchant(request, {
      resolveAlias: async () => null,
      rootDomain: 'usebaci.com',
      rpcClient: rpcClientReturning(null, { message: 'db down' }),
    });

    expect(result).toEqual({ error: 'temporarily_unavailable', ok: false });
  });
});

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

describe('checkCartQuota', () => {
  it('allows requests under budget and blocks past exhaustion', async () => {
    __resetCartQuotaStoreForTesting();
    const input = {
      merchantId: MERCHANT_ID,
      operation: 'bootstrap' as const,
      subject: 'ip-1',
    };

    let result = await checkCartQuota(input);
    expect(result.allowed).toBe(true);

    for (let attempt = 1; attempt < result.limit; attempt++) {
      result = await checkCartQuota(input);
      expect(result.allowed).toBe(true);
    }
    result = await checkCartQuota(input);
    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
    __resetCartQuotaStoreForTesting();
  });

  it('scopes budgets by merchant, subject and operation', async () => {
    __resetCartQuotaStoreForTesting();
    const first = await checkCartQuota({
      merchantId: MERCHANT_ID,
      operation: 'commands' as const,
      subject: 'guest-a1',
    });
    const otherMerchant = await checkCartQuota({
      merchantId: OTHER_MERCHANT_ID,
      operation: 'commands' as const,
      subject: 'guest-a1',
    });
    const otherSubject = await checkCartQuota({
      merchantId: MERCHANT_ID,
      operation: 'commands' as const,
      subject: 'guest-a2',
    });
    const otherOperation = await checkCartQuota({
      merchantId: MERCHANT_ID,
      operation: 'snapshot' as const,
      subject: 'guest-a1',
    });

    expect(first.remaining).toBe(first.limit - 1);
    expect(otherMerchant.remaining).toBe(otherMerchant.limit - 1);
    expect(otherSubject.remaining).toBe(otherSubject.limit - 1);
    expect(otherOperation.remaining).toBe(otherOperation.limit - 1);
    __resetCartQuotaStoreForTesting();
  });
});
