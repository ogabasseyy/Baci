import { NextRequest } from 'next/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  ChatwootCommerceContextError: class ChatwootCommerceContextError extends Error {
    constructor(readonly code: string) {
      super(code);
    }
  },
  readCartJsonBody: vi.fn(),
  checkCsrfProtection: vi.fn(async () => ({ valid: true })),
  loadChatwootCartContext: vi.fn(),
  rebindChatwootSessionCapability: vi.fn(),
  verifyChatwootSessionCapability: vi.fn(),
}));

vi.mock('@/lib/cart/request-context', () => ({
  readCartJsonBody: mocks.readCartJsonBody,
}));
vi.mock('@/lib/csrf', () => ({
  checkCsrfProtection: mocks.checkCsrfProtection,
}));
vi.mock('@/lib/chatwoot/cart-context', () => ({
  loadChatwootCartContext: mocks.loadChatwootCartContext,
}));
vi.mock('@/lib/chatwoot/commerce-context', () => ({
  ChatwootCommerceContextError: mocks.ChatwootCommerceContextError,
  rebindChatwootSessionCapability: mocks.rebindChatwootSessionCapability,
  verifyChatwootSessionCapability: mocks.verifyChatwootSessionCapability,
}));

import { POST } from './route';

describe('Chatwoot authorize input validation', () => {
  afterEach(() => vi.clearAllMocks());

  it('rejects malformed input before resolving cart context', async () => {
    mocks.readCartJsonBody.mockResolvedValue({ ok: true, body: {} });
    const request = new NextRequest(
      'https://shop.example.com/api/storefront/chatwoot/context/authorize',
      {
        method: 'POST',
        headers: {
          host: 'shop.example.com',
          origin: 'https://shop.example.com',
        },
      }
    );

    expect((await POST(request)).status).toBe(400);
    expect(mocks.loadChatwootCartContext).not.toHaveBeenCalled();
  });

  it('does not retry capability rebind for a configuration failure', async () => {
    const binding = {
      inboxId: 74,
      merchantId: '11111111-1111-4111-8111-111111111111',
      origin: 'https://shop.example.com',
      websiteToken: 'synthetic-widget-token-123456',
    };
    mocks.readCartJsonBody.mockResolvedValue({
      ok: true,
      body: { sessionToken: 'signed-session-token' },
    });
    mocks.loadChatwootCartContext.mockResolvedValue({
      ok: true,
      binding,
      state: {
        cartId: '22222222-2222-4222-8222-222222222222',
        cartSessionSha256: 'a'.repeat(64),
        cartVersion: 12,
        grantId: '33333333-3333-4333-8333-333333333333',
        inboxId: binding.inboxId,
        merchantId: binding.merchantId,
        origin: binding.origin,
        principalId: '44444444-4444-4444-8444-444444444444',
        websiteToken: binding.websiteToken,
      },
      cart: {},
    });
    mocks.verifyChatwootSessionCapability.mockRejectedValue(
      new mocks.ChatwootCommerceContextError('invalid_config')
    );
    const request = new NextRequest(
      'https://shop.example.com/api/storefront/chatwoot/context/authorize',
      {
        method: 'POST',
        headers: {
          host: 'shop.example.com',
          origin: 'https://shop.example.com',
        },
      }
    );

    const response = await POST(request);

    expect(response.status).toBe(503);
    expect(mocks.rebindChatwootSessionCapability).not.toHaveBeenCalled();
  });
});
