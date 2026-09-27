import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  headers: vi.fn(),
  resolveStorefrontMerchantFromRequest: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('next/headers', () => ({ headers: mocks.headers }));
vi.mock('@/lib/logger', () => ({ logger: { warn: vi.fn() } }));
vi.mock('@/lib/storefront-price-negotiation', () => ({
  hasStorefrontPriceNegotiation: () => true,
}));
vi.mock('@/lib/storefront-merchant', () => ({
  resolveStorefrontMerchantFromRequest:
    mocks.resolveStorefrontMerchantFromRequest,
}));

import {
  getAgenticChatTenantResolutionInput,
  resolveAgenticChatTenant,
} from './agentic-chat-tenant';

const merchant = {
  business_name: 'Demo Store',
  feature_settings: { agentic_checkout_enabled: true },
  id: 'merchant-1',
  is_published: true,
  payout_currency: 'NGN',
  slug: 'demo-store',
};

function makeRequest(host: string, hint?: string): Request {
  return new Request('https://chat.invalid/api/chat', {
    headers: {
      ...(hint ? { 'x-baci-storefront-slug': hint } : {}),
      host,
    },
  });
}

describe('resolveAgenticChatTenant', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    vi.stubEnv('BACI_AGENTIC_MERCHANT_SLUG', 'demo-store');
    mocks.resolveStorefrontMerchantFromRequest.mockResolvedValue({
      merchant,
      success: true,
    });
    mocks.headers.mockResolvedValue(new Headers({ host: 'usebaci.com' }));
  });

  it('uses the server-owned configured slug for a central mobile API host', async () => {
    const tenant = await resolveAgenticChatTenant(makeRequest('usebaci.com'));

    expect(tenant).toEqual({
      agenticCheckoutEnabled: true,
      businessName: 'Demo Store',
      currencyCode: 'NGN',
      merchantId: 'merchant-1',
      merchantSlug: 'demo-store',
      priceNegotiationEnabled: true,
    });
    expect(mocks.resolveStorefrontMerchantFromRequest).toHaveBeenCalledWith(
      expect.objectContaining({ fallbackIdentifier: 'demo-store' })
    );
  });

  it.each([
    [
      'usebaci.com',
      { fallbackIdentifier: 'demo-store', rootDomain: 'usebaci.com' },
    ],
    [
      'localhost:3000',
      { fallbackIdentifier: 'demo-store', rootDomain: 'usebaci.com' },
    ],
    ['demo-store.usebaci.com', { rootDomain: 'usebaci.com' }],
    ['unknown.example', { rootDomain: 'usebaci.com' }],
    [
      'baci-git-feature-acme.vercel.app',
      { fallbackIdentifier: 'demo-store', rootDomain: 'usebaci.com' },
    ],
    ['notvercel.app', { rootDomain: 'usebaci.com' }],
    ['a.b.vercel.app', { rootDomain: 'usebaci.com' }],
  ])('classifies the raw host before tenant lookup: %s', (host, expected) => {
    expect(
      getAgenticChatTenantResolutionInput({
        configuredSlug: 'demo-store',
        request: makeRequest(host),
      })
    ).toEqual(expected);
  });

  it('fails closed when Host is missing instead of trusting Request.url', () => {
    expect(
      getAgenticChatTenantResolutionInput({
        configuredSlug: 'demo-store',
        request: new Request('https://demo-store.usebaci.com/api/chat'),
      })
    ).toBeNull();
  });

  it.each([
    'demo-store.usebaci.com',
    'demo.example.com',
  ])('accepts the configured tenant on its trusted storefront host: %s', async (host) => {
    await expect(resolveAgenticChatTenant(makeRequest(host))).resolves.toEqual(
      expect.objectContaining({ merchantSlug: 'demo-store' })
    );
  });

  it('does not let a host-resolved different merchant select chat authority', async () => {
    mocks.resolveStorefrontMerchantFromRequest.mockResolvedValue({
      merchant: { ...merchant, id: 'merchant-2', slug: 'other-store' },
      success: true,
    });

    await expect(
      resolveAgenticChatTenant(makeRequest('other-store.usebaci.com'))
    ).resolves.toBeNull();
  });

  it('fails closed for unpublished or missing storefront tenants', async () => {
    mocks.resolveStorefrontMerchantFromRequest
      .mockResolvedValueOnce({
        merchant: { ...merchant, is_published: false },
        success: true,
      })
      .mockResolvedValueOnce({
        error: 'Chat storefront not found',
        status: 404,
        success: false,
      });

    await expect(
      resolveAgenticChatTenant(makeRequest('demo-store.usebaci.com'))
    ).resolves.toBeNull();
    await expect(
      resolveAgenticChatTenant(makeRequest('unknown.example'))
    ).resolves.toBeNull();
  });

  it('treats the client storefront hint as a mismatch assertion, not authority', async () => {
    await expect(
      resolveAgenticChatTenant(
        makeRequest('usebaci.com', 'attacker-controlled-store')
      )
    ).resolves.toBeNull();
  });

  it('preserves a widget hint when tools resolve tenant context from Next headers', async () => {
    mocks.headers.mockResolvedValue(
      new Headers({
        host: 'usebaci.com',
        'x-baci-storefront-slug': 'attacker-controlled-store',
      })
    );

    await expect(resolveAgenticChatTenant()).resolves.toBeNull();
  });

  it('honors the published checkout kill switch without changing tenant identity', async () => {
    mocks.resolveStorefrontMerchantFromRequest.mockResolvedValue({
      merchant: {
        ...merchant,
        feature_settings: { agentic_checkout_enabled: false },
      },
      success: true,
    });

    await expect(
      resolveAgenticChatTenant(makeRequest('usebaci.com', 'demo-store'))
    ).resolves.toEqual(
      expect.objectContaining({ agenticCheckoutEnabled: false })
    );
  });
});
