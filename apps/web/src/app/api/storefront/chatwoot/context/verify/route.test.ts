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
  verifyChatwootCommerceContext: vi.fn(),
}));

vi.mock('@/lib/cart/request-context', () => ({
  readCartJsonBody: mocks.readCartJsonBody,
}));
vi.mock('@/lib/csrf', () => ({
  checkCsrfProtection: mocks.checkCsrfProtection,
}));
vi.mock('@/lib/chatwoot/commerce-context', () => ({
  ChatwootCommerceContextError: mocks.ChatwootCommerceContextError,
  verifyChatwootCommerceContext: mocks.verifyChatwootCommerceContext,
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
    `${binding.origin}/api/storefront/chatwoot/context/verify`,
    {
      method: 'POST',
      headers: { host: 'shop.example.com', origin: binding.origin },
    }
  );
}

describe('Chatwoot context verification route', () => {
  afterEach(() => vi.clearAllMocks());

  it('verifies against current cart state and returns only the conversation binding', async () => {
    mocks.loadChatwootCartContext.mockResolvedValue({
      ok: true,
      binding,
      state,
    });
    mocks.readCartJsonBody.mockResolvedValue({
      ok: true,
      body: { challengeToken: 'challenge.jwt', contextToken: 'context.jwt' },
    });
    mocks.verifyChatwootCommerceContext.mockResolvedValue({
      conversationId: 905,
      requestId: 'request_7d3bd0e2',
      sessionExpiresAt: 1_799_000_000,
      sessionToken: 'baci.signed.session.capability',
    });

    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toContain('no-store');
    await expect(response.json()).resolves.toEqual({
      authorized: true,
      conversationId: 905,
      requestId: 'request_7d3bd0e2',
      sessionExpiresAt: 1_799_000_000,
      sessionToken: 'baci.signed.session.capability',
    });
    expect(mocks.verifyChatwootCommerceContext).toHaveBeenCalledWith({
      binding,
      challengeToken: 'challenge.jwt',
      contextToken: 'context.jwt',
      state,
    });
  });

  it('maps replay, unavailable replay storage, and missing cart context to safe denials', async () => {
    mocks.loadChatwootCartContext.mockResolvedValue({
      ok: true,
      binding,
      state,
    });
    mocks.readCartJsonBody.mockResolvedValue({
      ok: true,
      body: { challengeToken: 'challenge.jwt', contextToken: 'context.jwt' },
    });
    mocks.verifyChatwootCommerceContext.mockRejectedValue(
      new mocks.ChatwootCommerceContextError('replayed_context')
    );
    expect((await POST(request())).status).toBe(409);

    mocks.verifyChatwootCommerceContext.mockRejectedValueOnce(
      new mocks.ChatwootCommerceContextError('replay_store_unavailable')
    );
    expect((await POST(request())).status).toBe(503);

    mocks.loadChatwootCartContext.mockResolvedValue({
      ok: false,
      status: 401,
      code: 'invalid_proof',
    });
    expect((await POST(request())).status).toBe(401);
    expect(mocks.readCartJsonBody).toHaveBeenCalledTimes(3);
  });

  it('requires CSRF before cart resolution or token parsing', async () => {
    mocks.checkCsrfProtection.mockResolvedValueOnce({ valid: false });
    expect((await POST(request())).status).toBe(403);
    expect(mocks.loadChatwootCartContext).not.toHaveBeenCalled();
    expect(mocks.readCartJsonBody).not.toHaveBeenCalled();
  });

  it('rejects malformed input before resolving a cart context', async () => {
    mocks.readCartJsonBody.mockResolvedValue({ ok: true, body: { ...state } });

    expect((await POST(request())).status).toBe(400);
    expect(mocks.loadChatwootCartContext).not.toHaveBeenCalled();
    expect(mocks.verifyChatwootCommerceContext).not.toHaveBeenCalled();
  });
});
