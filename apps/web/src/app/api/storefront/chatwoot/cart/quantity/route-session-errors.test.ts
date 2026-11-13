import { NextRequest } from 'next/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  ChatwootCommerceContextError: class ChatwootCommerceContextError extends Error {
    constructor(readonly code: string) {
      super(code);
    }
  },
  checkCsrfProtection: vi.fn(async () => ({ valid: true })),
  loadChatwootCartContext: vi.fn(),
  readCartJsonBody: vi.fn(),
  verifyChatwootSessionCapability: vi.fn(),
  mutateCart: vi.fn(),
  checkCartQuota: vi.fn(),
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
  hashCartSessionProof: vi.fn(),
  renewChatwootSessionCapability: vi.fn(),
  verifyChatwootSessionCapability: mocks.verifyChatwootSessionCapability,
}));
vi.mock('@/lib/cart/service', () => ({ mutateCart: mocks.mutateCart }));
vi.mock('@/lib/cart/request-quota', () => ({
  checkCartQuota: mocks.checkCartQuota,
}));
vi.mock('@/lib/cart/grant-operations', () => ({
  loadLiveGrantOperations: vi.fn(),
  upgradeLegacySessionPrincipal: vi.fn(),
}));
vi.mock('@/lib/cart/cart-runtime-env', () => ({
  getCartProofEnvironment: vi.fn(),
}));
vi.mock('@/lib/cart/session-proof', () => ({
  cartSessionCookieMaxAge: vi.fn(),
  issueCartSessionProof: vi.fn(),
}));
vi.mock('@/lib/cart/scoped-client', () => ({
  createCartScopedClient: vi.fn(),
}));

import { POST } from './route';

const binding = {
  inboxId: 74,
  merchantId: '11111111-1111-4111-8111-111111111111',
  origin: 'https://shop.example.com',
  websiteToken: 'synthetic-widget-token-123456',
};
const state = {
  cartId: '22222222-2222-4222-8222-222222222222',
  cartSessionSha256: 'a'.repeat(64),
  cartVersion: 12,
  grantId: '33333333-3333-4333-8333-333333333333',
  inboxId: 74,
  merchantId: binding.merchantId,
  origin: binding.origin,
  principalId: '44444444-4444-4444-8444-444444444444',
  websiteToken: binding.websiteToken,
};

function arrange() {
  mocks.readCartJsonBody.mockResolvedValue({
    ok: true,
    body: {
      cartVersion: 12,
      conversationId: 905,
      expectedQuantity: 2,
      lineId: '55555555-5555-4555-8555-555555555555',
      quantity: 3,
      requestId: 'quantity-0001',
      sessionToken: 'signed-session-capability',
    },
  });
  mocks.loadChatwootCartContext.mockResolvedValue({
    ok: true,
    binding,
    state,
    principal: { cartId: state.cartId },
    cart: {
      cartId: state.cartId,
      merchantId: binding.merchantId,
      version: 12,
      expiresAt: '2026-11-30T00:00:00.000Z',
      lines: [{ id: '55555555-5555-4555-8555-555555555555', quantity: 2 }],
    },
  });
}

function request() {
  return new NextRequest(
    `${binding.origin}/api/storefront/chatwoot/cart/quantity`,
    {
      method: 'POST',
      headers: { host: 'shop.example.com', origin: binding.origin },
    }
  );
}

describe('Chatwoot quantity session verification errors', () => {
  afterEach(() => vi.clearAllMocks());

  it('distinguishes invalid sessions from configuration and unexpected failures', async () => {
    arrange();
    mocks.verifyChatwootSessionCapability.mockRejectedValueOnce(
      new mocks.ChatwootCommerceContextError('invalid_context')
    );
    expect((await POST(request())).status).toBe(403);

    arrange();
    mocks.verifyChatwootSessionCapability.mockRejectedValueOnce(
      new mocks.ChatwootCommerceContextError('invalid_config')
    );
    const configResponse = await POST(request());
    expect(configResponse.status).toBe(503);
    await expect(configResponse.json()).resolves.toEqual({
      accepted: false,
      code: 'temporarily_unavailable',
    });

    arrange();
    mocks.verifyChatwootSessionCapability.mockRejectedValueOnce(
      new Error('unexpected verifier failure')
    );
    expect((await POST(request())).status).toBe(503);
    expect(mocks.mutateCart).not.toHaveBeenCalled();
  });
});
