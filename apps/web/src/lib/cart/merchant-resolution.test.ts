import { describe, expect, it, vi } from 'vitest';

import { resolveCartMerchant } from './request-context';

const MERCHANT_ID = '11111111-1111-4111-8111-111111111111';

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

describe('resolveCartMerchant', () => {
  it('fails closed for a merchant without shared-cart enrollment', async () => {
    const request = new Request('https://ogabassey.usebaci.com/api/x', {
      headers: { 'x-merchant-slug': 'ogabassey' },
    });

    const result = await resolveCartMerchant(request, {
      loadMerchantFeatures: async () => ({ premium_features: [] }),
      resolveAlias: async () => null,
      rootDomain: 'usebaci.com',
      rpcClient: rpcClientReturning([merchantRow()]),
    });

    expect(result).toEqual({ error: 'merchant_unavailable', ok: false });
  });

  it('resolves an enrolled merchant when the feature lookup passes', async () => {
    const request = new Request('https://ogabassey.usebaci.com/api/x', {
      headers: { 'x-merchant-slug': 'ogabassey' },
    });

    const result = await resolveCartMerchant(request, {
      loadMerchantFeatures: async () => ({
        premium_features: ['shared_cart'],
      }),
      resolveAlias: async () => null,
      rootDomain: 'usebaci.com',
      rpcClient: rpcClientReturning([merchantRow()]),
    });

    expect(result.ok).toBe(true);
  });

  it('fails closed when the enrollment lookup finds no merchant row', async () => {
    const request = new Request('https://ogabassey.usebaci.com/api/x', {
      headers: { 'x-merchant-slug': 'ogabassey' },
    });

    const result = await resolveCartMerchant(request, {
      loadMerchantFeatures: async () => null,
      resolveAlias: async () => null,
      rootDomain: 'usebaci.com',
      rpcClient: rpcClientReturning([merchantRow()]),
    });

    expect(result).toEqual({ error: 'temporarily_unavailable', ok: false });
  });

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

it('does not let a query merchant override a storefront host', async () => {
  const client = rpcClientReturning([merchantRow()]);
  const result = await resolveCartMerchant(
    new Request(
      'https://other-store.usebaci.com/api/storefront/cart?merchantSlug=ogabassey'
    ),
    {
      resolveAlias: async () => null,
      rootDomain: 'usebaci.com',
      rpcClient: client,
    }
  );
  expect(result).toEqual({ ok: false, error: 'merchant_unresolved' });
});

it('resolves a dedicated storefront host without proxy headers', async () => {
  const client = rpcClientReturning([
    merchantRow({ custom_domain: 'ogabassey.com' }),
  ]);
  const result = await resolveCartMerchant(
    new Request('https://ogabassey.com/api/storefront/cart'),
    {
      resolveAlias: async () => null,
      rootDomain: 'usebaci.com',
      rpcClient: client,
    }
  );
  expect(result.ok).toBe(true);
  expect(client.rpc).toHaveBeenCalledWith('resolve_storefront_auth_merchant', {
    p_identifier: 'ogabassey.com',
  });
});
