import { NextRequest } from 'next/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  CHATWOOT_CHALLENGE_TTL_SECONDS: 90,
  checkCsrfProtection: vi.fn(async () => ({ valid: true })),
  getFixedChatwootPlatformOrigin: vi.fn(() => 'https://support.example.com'),
  issueChatwootCommerceChallenge: vi.fn(async () => 'signed-challenge'),
  loadChatwootCartContext: vi.fn(),
  readCartJsonBody: vi.fn(),
}));

vi.mock('@/lib/cart/request-context', () => ({
  readCartJsonBody: mocks.readCartJsonBody,
}));
vi.mock('@/lib/csrf', () => ({
  checkCsrfProtection: mocks.checkCsrfProtection,
}));
vi.mock('@/lib/chatwoot/commerce-context', () => ({
  CHATWOOT_CHALLENGE_TTL_SECONDS: mocks.CHATWOOT_CHALLENGE_TTL_SECONDS,
  ChatwootCommerceContextError: class ChatwootCommerceContextError extends Error {
    constructor(readonly code: string) {
      super(code);
    }
  },
  getFixedChatwootPlatformOrigin: mocks.getFixedChatwootPlatformOrigin,
  issueChatwootCommerceChallenge: mocks.issueChatwootCommerceChallenge,
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
    `${binding.origin}/api/storefront/chatwoot/context/challenge`,
    {
      method: 'POST',
      headers: { host: 'shop.example.com', origin: binding.origin },
    }
  );
}

describe('Chatwoot context challenge route', () => {
  afterEach(() => vi.clearAllMocks());

  it('issues only for the resolved tenant binding and returns a no-store fixed widget origin', async () => {
    mocks.loadChatwootCartContext.mockResolvedValue({
      ok: true,
      binding,
      state,
    });
    mocks.readCartJsonBody.mockResolvedValue({
      ok: true,
      body: {
        conversationId: 905,
        requestId: 'request_7d3bd0e2',
        visitorTokenSha256: 'b'.repeat(64),
        websiteToken: binding.websiteToken,
      },
    });

    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toContain('no-store');
    await expect(response.json()).resolves.toMatchObject({
      challengeToken: 'signed-challenge',
      requestId: 'request_7d3bd0e2',
      widgetOrigin: 'https://support.example.com',
    });
    expect(mocks.issueChatwootCommerceChallenge).toHaveBeenCalledWith(
      expect.objectContaining({ ...state, conversationId: 905 }),
      expect.any(Object)
    );
  });

  it('rejects request-selected widget tokens or malformed bodies before signing', async () => {
    mocks.loadChatwootCartContext.mockResolvedValue({
      ok: true,
      binding,
      state,
    });
    mocks.readCartJsonBody.mockResolvedValue({
      ok: true,
      body: {
        conversationId: 905,
        requestId: 'request_7d3bd0e2',
        visitorTokenSha256: 'b'.repeat(64),
        websiteToken: 'attacker-selected-widget-token',
      },
    });
    expect((await POST(request())).status).toBe(403);
    expect(mocks.issueChatwootCommerceChallenge).not.toHaveBeenCalled();

    mocks.readCartJsonBody.mockResolvedValue({ ok: true, body: { ...state } });
    expect((await POST(request())).status).toBe(400);
    expect(mocks.issueChatwootCommerceChallenge).not.toHaveBeenCalled();
  });

  it('rejects malformed input before resolving a cart context', async () => {
    mocks.readCartJsonBody.mockResolvedValue({ ok: true, body: { ...state } });

    expect((await POST(request())).status).toBe(400);
    expect(mocks.loadChatwootCartContext).not.toHaveBeenCalled();
  });

  it('rejects tenant A widget credentials on same-origin tenant B cart context', async () => {
    const tenantB = {
      inboxId: 75,
      merchantId: '6df442af-4d21-4f4f-9f0b-607400000099',
      origin: binding.origin,
      websiteToken: 'tenant-b-widget-token-123456',
    };
    mocks.loadChatwootCartContext.mockResolvedValue({
      ok: true,
      binding: tenantB,
      state: {
        ...state,
        inboxId: tenantB.inboxId,
        merchantId: tenantB.merchantId,
        websiteToken: tenantB.websiteToken,
      },
    });
    mocks.readCartJsonBody.mockResolvedValue({
      ok: true,
      body: {
        conversationId: 905,
        requestId: 'request_7d3bd0e2',
        visitorTokenSha256: 'b'.repeat(64),
        websiteToken: binding.websiteToken,
      },
    });

    expect((await POST(request())).status).toBe(403);
    expect(mocks.issueChatwootCommerceChallenge).not.toHaveBeenCalled();
  });

  it('requires CSRF before reading input and validates input before resolving the cart', async () => {
    mocks.readCartJsonBody.mockResolvedValue({
      ok: true,
      body: {
        conversationId: 905,
        requestId: 'request_7d3bd0e2',
        visitorTokenSha256: 'b'.repeat(64),
        websiteToken: binding.websiteToken,
      },
    });
    mocks.checkCsrfProtection.mockResolvedValueOnce({ valid: false });
    expect((await POST(request())).status).toBe(403);
    expect(mocks.loadChatwootCartContext).not.toHaveBeenCalled();
    expect(mocks.readCartJsonBody).not.toHaveBeenCalled();

    mocks.loadChatwootCartContext.mockResolvedValueOnce({
      ok: false,
      status: 404,
      code: 'disabled',
    });
    expect((await POST(request())).status).toBe(404);
    expect(mocks.readCartJsonBody).toHaveBeenCalledOnce();
  });
});
