import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  ChatwootCommerceContextError: class ChatwootCommerceContextError extends Error {
    constructor(readonly code: string) {
      super(code);
    }
  },
  createAnonClient: vi.fn(() => ({ rpc: vi.fn() })),
  createAnonMerchantFeatureLookup: vi.fn(() => vi.fn()),
  createCartScopedClient: vi.fn(() => ({ cart: 'scoped' })),
  getCart: vi.fn(),
  getCartProofEnvironment: vi.fn(() => 'test'),
  getChatwootTenantBinding: vi.fn(),
  getCurrentSlugForAlias: vi.fn(),
  requestUsesDeviceProof: vi.fn(() => false),
  resolveCartRequestContext: vi.fn(),
  verifyCartSessionProof: vi.fn(),
  hashCartSessionProof: vi.fn((proof: string) =>
    proof === 'verified-session-proof' ? 'a'.repeat(64) : 'b'.repeat(64)
  ),
}));

vi.mock('@/lib/cart/merchant-resolution', () => ({
  createAnonMerchantFeatureLookup: mocks.createAnonMerchantFeatureLookup,
}));
vi.mock('@/lib/cart/scoped-client', () => ({
  createCartScopedClient: mocks.createCartScopedClient,
}));
vi.mock('@/lib/cart/request-context', () => ({
  requestUsesDeviceProof: mocks.requestUsesDeviceProof,
  resolveCartRequestContext: mocks.resolveCartRequestContext,
}));
vi.mock('@/lib/cart/cart-runtime-env', () => ({
  getCartProofEnvironment: mocks.getCartProofEnvironment,
}));
vi.mock('@/lib/cart/service', () => ({ getCart: mocks.getCart }));
vi.mock('@/lib/cart/session-proof', () => ({
  verifyCartSessionProof: mocks.verifyCartSessionProof,
}));
vi.mock('@/lib/supabase/anon', () => ({
  createAnonClient: mocks.createAnonClient,
}));
vi.mock('@/lib/slug-alias-cache', () => ({
  getCurrentSlugForAlias: mocks.getCurrentSlugForAlias,
}));
vi.mock('./commerce-context', () => ({
  ChatwootCommerceContextError: mocks.ChatwootCommerceContextError,
  getChatwootTenantBinding: mocks.getChatwootTenantBinding,
  hashCartSessionProof: mocks.hashCartSessionProof,
  normalizeHttpsOrigin: (origin: string | null) => origin,
}));

import { NextRequest } from 'next/server';
import { loadChatwootCartContext } from './cart-context';

const merchantId = '6df442af-4d21-4f4f-9f0b-607400000001';
const cartId = '6df442af-4d21-4f4f-9f0b-607400000002';
const grantId = '6df442af-4d21-4f4f-9f0b-607400000003';
const principalId = '6df442af-4d21-4f4f-9f0b-607400000004';
const binding = {
  merchantId,
  origin: 'https://shop.example.com',
  websiteToken: 'synthetic-widget-token-123456',
  inboxId: 74,
};

function makeRequest(origin = binding.origin) {
  return new NextRequest(
    `${origin}/api/storefront/chatwoot/context/challenge`,
    {
      headers: { host: new URL(origin).host, origin },
    }
  );
}

function useVerifiedCartContext(resolvedMerchantId = merchantId) {
  mocks.resolveCartRequestContext.mockImplementation(async (_request, deps) => {
    await deps.verify('verified-session-proof');
    return {
      ok: true,
      merchant: { id: resolvedMerchantId, slug: 'shop' },
      principal: {
        cartId,
        grantId,
        merchantId: resolvedMerchantId,
        principalId,
        scope: 'session',
        expiresAt: '2026-11-08T12:00:00.000Z',
      },
    };
  });
  mocks.getChatwootTenantBinding.mockImplementation((id: string) => {
    if (id !== merchantId) {
      throw new mocks.ChatwootCommerceContextError('binding_unavailable');
    }
    return binding;
  });
  mocks.getCart.mockResolvedValue({
    ok: true,
    cart: { cartId, merchantId: resolvedMerchantId, version: 12 },
  });
}

describe('loadChatwootCartContext', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it('does no cart work when the feature is off', async () => {
    vi.stubEnv('EKAETTE_CHATWOOT_CONTEXT_ENABLED', 'false');

    await expect(loadChatwootCartContext(makeRequest())).resolves.toMatchObject(
      {
        ok: false,
        status: 404,
        code: 'disabled',
      }
    );
    expect(mocks.resolveCartRequestContext).not.toHaveBeenCalled();
  });

  it('maps a wrong-scope cart proof to an authorization response', async () => {
    vi.stubEnv('EKAETTE_CHATWOOT_CONTEXT_ENABLED', 'true');
    mocks.resolveCartRequestContext.mockResolvedValue({
      ok: false,
      error: 'unauthorized',
    });

    await expect(loadChatwootCartContext(makeRequest())).resolves.toMatchObject(
      {
        ok: false,
        status: 401,
        code: 'unauthorized',
      }
    );
    expect(mocks.getCart).not.toHaveBeenCalled();
  });

  it('rejects device proofs and origins outside the exact host binding', async () => {
    vi.stubEnv('EKAETTE_CHATWOOT_CONTEXT_ENABLED', 'true');
    useVerifiedCartContext();
    mocks.requestUsesDeviceProof.mockReturnValueOnce(true);
    await expect(loadChatwootCartContext(makeRequest())).resolves.toMatchObject(
      {
        ok: false,
        status: 403,
        code: 'browser_session_required',
      }
    );

    await expect(
      loadChatwootCartContext(makeRequest('https://attacker.example'))
    ).resolves.toMatchObject({
      ok: false,
      status: 403,
      code: 'origin_mismatch',
    });
  });

  it('binds only the host-resolved tenant and the current canonical cart snapshot', async () => {
    vi.stubEnv('EKAETTE_CHATWOOT_CONTEXT_ENABLED', 'true');
    useVerifiedCartContext();
    const result = await loadChatwootCartContext(makeRequest());

    expect(result).toMatchObject({
      ok: true,
      binding,
      state: {
        cartId,
        cartSessionSha256: 'a'.repeat(64),
        cartVersion: 12,
        grantId,
        merchantId,
        origin: binding.origin,
        principalId,
      },
    });
    expect(mocks.resolveCartRequestContext).toHaveBeenCalledWith(
      expect.any(NextRequest),
      expect.objectContaining({
        requireScope: 'session',
        wrongScopeError: 'unauthorized',
      })
    );
    expect(mocks.getChatwootTenantBinding).toHaveBeenCalledWith(merchantId);
    expect(mocks.hashCartSessionProof).toHaveBeenCalledWith(
      'verified-session-proof'
    );
    expect(JSON.stringify(result)).not.toContain('verified-session-proof');
  });

  it.each([
    'expired',
    'not_found',
  ] as const)('returns a terminal cart response when the initial snapshot is %s', async (code) => {
    vi.stubEnv('EKAETTE_CHATWOOT_CONTEXT_ENABLED', 'true');
    useVerifiedCartContext();
    mocks.getCart.mockResolvedValueOnce({ ok: false, code });

    await expect(loadChatwootCartContext(makeRequest())).resolves.toMatchObject(
      {
        ok: false,
        status: 410,
        code: 'cart_expired',
      }
    );
  });

  it('allows shared storefront origins while using only the resolved tenant binding and cart', async () => {
    vi.stubEnv('EKAETTE_CHATWOOT_CONTEXT_ENABLED', 'true');
    const tenantBId = '6df442af-4d21-4f4f-9f0b-607400000099';
    const tenantBBinding = {
      merchantId: tenantBId,
      origin: binding.origin,
      websiteToken: 'tenant-b-widget-token-123456',
      inboxId: binding.inboxId + 1,
    };
    mocks.resolveCartRequestContext.mockImplementation(
      async (_request, deps) => {
        await deps.verify('verified-session-proof');
        return {
          ok: true,
          merchant: { id: tenantBId, slug: 'tenant-b' },
          principal: {
            cartId,
            grantId,
            merchantId: tenantBId,
            principalId,
            scope: 'session',
            expiresAt: '2026-11-08T12:00:00.000Z',
          },
        };
      }
    );
    mocks.getChatwootTenantBinding.mockReturnValue(tenantBBinding);
    mocks.getCart.mockResolvedValue({
      ok: true,
      cart: { cartId, merchantId: tenantBId, version: 4 },
    });

    const result = await loadChatwootCartContext(makeRequest());

    expect(result).toMatchObject({
      ok: true,
      binding: tenantBBinding,
      state: {
        merchantId: tenantBId,
        origin: binding.origin,
        websiteToken: tenantBBinding.websiteToken,
        inboxId: tenantBBinding.inboxId,
        cartVersion: 4,
      },
    });
    expect(mocks.getChatwootTenantBinding).toHaveBeenCalledWith(tenantBId);
    expect(mocks.createCartScopedClient).toHaveBeenCalledWith(
      expect.objectContaining({ merchantId: tenantBId })
    );
    const merchantDeps =
      mocks.resolveCartRequestContext.mock.calls[0]?.[1].merchant;
    expect(merchantDeps.bodyHint).toBeUndefined();
  });

  it('fails with not-found if a host-resolved merchant has no configured widget binding', async () => {
    vi.stubEnv('EKAETTE_CHATWOOT_CONTEXT_ENABLED', 'true');
    useVerifiedCartContext('6df442af-4d21-4f4f-9f0b-607400000099');

    await expect(loadChatwootCartContext(makeRequest())).resolves.toMatchObject(
      {
        ok: false,
        status: 404,
        code: 'binding_unavailable',
      }
    );
    expect(mocks.getCart).not.toHaveBeenCalled();
  });
});
