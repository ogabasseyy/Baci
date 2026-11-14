import { expect, it, vi } from 'vitest';
import { HYDRATION_SELECT } from '@/hooks/cart/shared-cart-products';
import { createPublicVerificationRelay } from './public-verification-relay';

const binding = {
  merchantId: '11111111-1111-4111-8111-111111111111',
  slug: 'qa1',
  canonicalBase: 'https://qa1.example.com',
  buildDigest: 'a'.repeat(64),
  head: { policyRevision: 'policy-1' },
};
const product = { id: '33333333-3333-4333-8333-333333333333', slug: 'device' };
const supabase = {
  url: 'https://project.supabase.co',
  anonKey: 'sb_publishable_synthetic123',
};

it('relays only bound framework requests through the constrained reader', async () => {
  const readFramework = vi.fn(async () => ({ status: 200, body: '{}' }));
  const relay = createPublicVerificationRelay(
    { binding, product, supabase, paths: ['/'] },
    {
      makeCartNetwork: () => async () => ({
        status: 200,
        body: Buffer.from('{}'),
        cookies: [],
      }),
      makeProductNetwork: () => async () => ({ status: 200, body: '[]' }),
      makeStateReader: () => async () => ({ status: 200, body: '{}' }),
      makeCatalogReader: () => async () => ({ status: 200, body: '{}' }),
      makeFrameworkReader: () => readFramework,
    }
  );
  const request = {
    url: `${binding.canonicalBase}/_next/static/chunks/a.js`,
    method: 'GET' as const,
  };
  await expect(relay(request)).resolves.toEqual({ status: 200, body: '{}' });
  expect(readFramework).toHaveBeenCalledWith(request);
  await expect(
    relay({ ...request, url: 'https://other.example/_next/static/a.js' })
  ).rejects.toThrow();
  expect(readFramework).toHaveBeenCalledOnce();
});

it('binds cart and product relay to the resolved merchant and public client', async () => {
  const makeCartNetwork = vi.fn(() => async () => ({
    status: 200,
    body: Buffer.from('{}'),
    cookies: [],
  }));
  const makeProductNetwork = vi.fn(() => async () => ({
    status: 200,
    body: '[]',
  }));
  const readState = vi.fn(async () => ({ status: 200, body: '{}' }));
  const makeStateReader = vi.fn(() => readState);
  const readCatalog = vi.fn(async () => ({ status: 200, body: '{}' }));
  const makeCatalogReader = vi.fn(() => readCatalog);
  const relay = createPublicVerificationRelay(
    { binding, product, supabase, paths: ['/'] },
    { makeCartNetwork, makeProductNetwork, makeStateReader, makeCatalogReader }
  );
  const stateRequest = {
    url: `${binding.canonicalBase}/api/storefront/experience/state?merchantSlug=qa1&buildDigest=${binding.buildDigest}&path=%2F`,
    method: 'GET' as const,
  };
  await relay(stateRequest);
  const catalogRequest = {
    url: `${binding.canonicalBase}/api/storefront/experience/catalog?merchantSlug=qa1`,
    method: 'GET' as const,
  };
  await relay(catalogRequest);
  expect(readCatalog).toHaveBeenCalledWith(catalogRequest);
  expect(readState).toHaveBeenCalledWith(stateRequest);
  expect(makeStateReader).toHaveBeenCalledWith(
    expect.objectContaining({ policyRevision: 'policy-1' }),
    ['/']
  );
  const url = new URL(`${supabase.url}/rest/v1/products`);
  url.searchParams.set('select', HYDRATION_SELECT.replace(/\s+/g, ''));
  url.searchParams.set('merchant_id', `eq.${binding.merchantId}`);
  url.searchParams.set('id', `in.(${product.id})`);
  url.searchParams.set('status', 'eq.active');
  await expect(relay({ url: url.href, method: 'GET' })).resolves.toEqual({
    status: 200,
    body: '[]',
  });
  await expect(
    relay({
      url: `${binding.canonicalBase}/api/orders`,
      method: 'POST',
      body: '{}',
    })
  ).rejects.toThrow();
  expect(makeProductNetwork).toHaveBeenCalledWith(
    expect.objectContaining({
      origin: supabase.url,
      publishableKey: supabase.anonKey,
      merchantId: binding.merchantId,
      productId: product.id,
    })
  );
  expect(makeCartNetwork).toHaveBeenCalledWith(
    expect.objectContaining({
      origin: binding.canonicalBase,
      merchantSlug: binding.slug,
      productId: product.id,
    })
  );
});

it('rejects invalid tenant, product, origin and privileged key configuration', () => {
  for (const input of [
    { binding: { ...binding, merchantId: 'not-a-uuid' }, product, supabase },
    { binding, product: { id: 'invalid', slug: 'device' }, supabase },
    {
      binding: { ...binding, canonicalBase: 'http://127.0.0.1' },
      product,
      supabase,
    },
    {
      binding,
      product,
      supabase: { ...supabase, anonKey: 'sb_secret_sensitive' },
    },
  ])
    expect(() =>
      createPublicVerificationRelay({ ...input, paths: ['/'] })
    ).toThrow();
});

it('renews only the bound launch with host-owned CSRF and rejects stale renewal responses', async () => {
  const expiresAt = Date.now() + 60000;
  let policyRevision = 'policy-1';
  const network = vi.fn(
    async (request: { url: string; headers: Record<string, string> }) => ({
      status: 200,
      body: Buffer.from(
        request.url.endsWith('/api/csrf')
          ? '{}'
          : JSON.stringify({
              buildDigest: binding.buildDigest,
              policyRevision,
              catalogRevision: 'catalog',
              expiresAt,
            })
      ),
      cookies: request.url.endsWith('/api/csrf')
        ? [`__Host-csrf-token=${'x'.repeat(43)}; Path=/; Secure`]
        : [],
    })
  );
  const relay = createPublicVerificationRelay(
    { binding, product, supabase, paths: ['/'] },
    {
      makeCartNetwork: () => network,
      makeProductNetwork: () => async () => ({ status: 200, body: '[]' }),
      makeStateReader: () => async () => ({ status: 200, body: '{}' }),
      makeCatalogReader: () => async () => ({ status: 200, body: '{}' }),
    }
  );
  await relay({ url: `${binding.canonicalBase}/api/csrf`, method: 'GET' });
  const request = {
    url: `${binding.canonicalBase}/api/storefront/experience/launch?merchantSlug=qa1&buildDigest=${binding.buildDigest}&path=%2F`,
    method: 'POST' as const,
    body: JSON.stringify({ buildDigest: binding.buildDigest, path: '/' }),
  };
  await expect(relay(request)).resolves.toMatchObject({ status: 200 });
  expect(network.mock.calls[1][0].headers['x-csrf-token']).toBe('x'.repeat(43));
  policyRevision = 'stale';
  await expect(relay(request)).rejects.toThrow('PUBLIC_LAUNCH_MISMATCH');
});
