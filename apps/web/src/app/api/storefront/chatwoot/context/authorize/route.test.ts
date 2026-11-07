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
}));

vi.mock('@/lib/cart/request-context', () => ({
  readCartJsonBody: mocks.readCartJsonBody,
}));
vi.mock('@/lib/csrf', () => ({
  checkCsrfProtection: mocks.checkCsrfProtection,
}));
vi.mock('@/lib/chatwoot/commerce-context', () => ({
  ChatwootCommerceContextError: mocks.ChatwootCommerceContextError,
  verifyChatwootSessionCapability: mocks.verifyChatwootSessionCapability,
}));
vi.mock('@/lib/chatwoot/cart-context', () => ({
  loadChatwootCartContext: mocks.loadChatwootCartContext,
}));

import { POST } from './route';

const binding = {
  inboxId: 74,
  merchantId: '6df442af-4d21-4f4f-9f0b-607400000001',
  origin: 'https://shop.example.com',
  websiteToken: 'synthetic-widget-token-123456',
};
const state = {
  cartId: '6df442af-4d21-4f4f-9f0b-607400000002',
  cartSessionSha256: 'a'.repeat(64),
  cartVersion: 12,
  grantId: '6df442af-4d21-4f4f-9f0b-607400000003',
  inboxId: binding.inboxId,
  merchantId: binding.merchantId,
  origin: binding.origin,
  principalId: '6df442af-4d21-4f4f-9f0b-607400000004',
  websiteToken: binding.websiteToken,
};

function request() {
  return new NextRequest(
    `${binding.origin}/api/storefront/chatwoot/context/authorize`,
    {
      method: 'POST',
      headers: { host: 'shop.example.com', origin: binding.origin },
    }
  );
}

describe('Chatwoot context authorization route', () => {
  afterEach(() => vi.clearAllMocks());

  it('rechecks current cart/session authority before allowing a scoped conversation action', async () => {
    mocks.loadChatwootCartContext.mockResolvedValue({
      ok: true,
      binding,
      state,
    });
    mocks.readCartJsonBody.mockResolvedValue({
      ok: true,
      body: { sessionToken: 'baci.signed.session.capability' },
    });
    mocks.verifyChatwootSessionCapability.mockResolvedValue({
      conversationId: 905,
      sessionExpiresAt: 1_799_000_000,
    });

    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toContain('no-store');
    await expect(response.json()).resolves.toEqual({
      authorized: true,
      conversationId: 905,
      sessionExpiresAt: 1_799_000_000,
    });
    expect(mocks.verifyChatwootSessionCapability).toHaveBeenCalledWith({
      binding,
      sessionToken: 'baci.signed.session.capability',
      state,
    });
  });

  it('fails closed on bad capability, missing current session, or CSRF failure', async () => {
    mocks.loadChatwootCartContext.mockResolvedValue({
      ok: true,
      binding,
      state,
    });
    mocks.readCartJsonBody.mockResolvedValue({
      ok: true,
      body: { sessionToken: 'forged' },
    });
    mocks.verifyChatwootSessionCapability.mockRejectedValue(
      new mocks.ChatwootCommerceContextError('invalid_context')
    );
    expect((await POST(request())).status).toBe(403);

    mocks.loadChatwootCartContext.mockResolvedValue({
      ok: false,
      status: 401,
      code: 'invalid_proof',
    });
    expect((await POST(request())).status).toBe(401);
    expect(mocks.verifyChatwootSessionCapability).toHaveBeenCalledOnce();

    mocks.checkCsrfProtection.mockResolvedValueOnce({ valid: false });
    expect((await POST(request())).status).toBe(403);
    expect(mocks.loadChatwootCartContext).toHaveBeenCalledTimes(2);
  });
});
