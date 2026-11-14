import { NextRequest } from 'next/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  ChatwootCommerceContextError: class ChatwootCommerceContextError extends Error {
    constructor(readonly code: string) {
      super(code);
    }
  },
  checkCartQuota: vi.fn(async () => ({ allowed: true })),
  checkCsrfProtection: vi.fn(async () => ({ valid: true })),
  createCartScopedClient: vi.fn(),
  getCart: vi.fn(),
  loadChatwootCartContext: vi.fn(),
  loadLiveGrantOperations: vi.fn(),
  readCartJsonBody: vi.fn(),
  rpc: vi.fn(),
  renewChatwootSessionCapability: vi.fn(),
  upgradeLegacySessionPrincipal: vi.fn(),
  verifyChatwootSessionCapability: vi.fn(),
}));

vi.mock('@/lib/cart/request-context', () => ({
  readCartJsonBody: mocks.readCartJsonBody,
}));
vi.mock('@/lib/cart/request-quota', () => ({
  checkCartQuota: mocks.checkCartQuota,
}));
vi.mock('@/lib/cart/scoped-client', () => ({
  createCartScopedClient: mocks.createCartScopedClient,
}));
vi.mock('@/lib/cart/service', () => ({ getCart: mocks.getCart }));
vi.mock('@/lib/cart/grant-operations', () => ({
  loadLiveGrantOperations: mocks.loadLiveGrantOperations,
  upgradeLegacySessionPrincipal: mocks.upgradeLegacySessionPrincipal,
}));
vi.mock('@/lib/chatwoot/cart-context', () => ({
  loadChatwootCartContext: mocks.loadChatwootCartContext,
}));
vi.mock('@/lib/chatwoot/commerce-context', () => ({
  ChatwootCommerceContextError: mocks.ChatwootCommerceContextError,
  hashCartSessionProof: vi.fn(() => 'a'.repeat(64)),
  renewChatwootSessionCapability: mocks.renewChatwootSessionCapability,
  verifyChatwootSessionCapability: mocks.verifyChatwootSessionCapability,
}));
vi.mock('@/lib/csrf', () => ({
  checkCsrfProtection: mocks.checkCsrfProtection,
}));

import { POST } from './route';

const merchantId = '11111111-1111-4111-8111-111111111111';
const cartId = '22222222-2222-4222-8222-222222222222';
const principal = {
  allowedOperations: ['add'],
  cartId,
  grantId: '33333333-3333-4333-8333-333333333333',
  merchantId,
  principalId: 'buyer-1',
  expiresAt: '2026-11-20T00:00:00.000Z',
  scope: 'session',
};
const state = {
  cartId,
  cartSessionSha256: 'b'.repeat(64),
  cartVersion: 12,
  grantId: principal.grantId,
  inboxId: 74,
  merchantId,
  origin: 'https://shop.example.com',
  principalId: principal.principalId,
  websiteToken: 'synthetic-widget-token-123456',
};
const binding = {
  inboxId: 74,
  merchantId,
  origin: 'https://shop.example.com',
  websiteToken: 'synthetic-widget-token-123456',
};
const body = {
  cartVersion: 12,
  conversationId: 905,
  productSlug: 'phone-13',
  requestId: 'add-request-01',
  sessionToken: 'signed-session-token',
  variantId: '44444444-4444-4444-8444-444444444444',
};

function request() {
  return new NextRequest(
    'https://shop.example.com/api/storefront/chatwoot/cart/add',
    {
      method: 'POST',
      headers: { host: 'shop.example.com', origin: 'https://shop.example.com' },
    }
  );
}

function arrange(input: unknown = body, cartVersion = 12) {
  mocks.readCartJsonBody.mockResolvedValue({ ok: true, body: input });
  mocks.loadChatwootCartContext.mockResolvedValue({
    ok: true,
    binding,
    cart: {
      cartId,
      merchantId,
      version: cartVersion,
      expiresAt: '2026-11-30T00:00:00.000Z',
      lines: [],
    },
    principal,
    state: { ...state, cartVersion },
  });
  mocks.verifyChatwootSessionCapability.mockResolvedValue({
    conversationId: 905,
    sessionExpiresAt: 1_799_000_000,
  });
  mocks.rpc.mockReset().mockResolvedValue({
    data: { ok: false, code: 'invalid_item' },
  });
  mocks.createCartScopedClient.mockReturnValue({ rpc: mocks.rpc });
  mocks.upgradeLegacySessionPrincipal.mockResolvedValue(principal);
  mocks.loadLiveGrantOperations.mockResolvedValue({
    allowedOperations: ['add'],
    grantExpiresAt: '2026-11-20T00:00:00.000Z',
  });
}

afterEach(() => {
  vi.clearAllMocks();
});

describe('Chatwoot shared-cart add route', () => {
  it('rejects CSRF before reading the body or loading cart context', async () => {
    mocks.checkCsrfProtection.mockResolvedValueOnce({ valid: false });

    const response = await POST(request());

    expect(response.status).toBe(403);
    expect(mocks.readCartJsonBody).not.toHaveBeenCalled();
    expect(mocks.loadChatwootCartContext).not.toHaveBeenCalled();
  });

  it('rejects malformed input before database-backed context lookup', async () => {
    arrange({ ...body, variantId: 'not-a-uuid' });

    const response = await POST(request());

    expect(response.status).toBe(400);
    expect(mocks.loadChatwootCartContext).not.toHaveBeenCalled();
  });

  it('rejects short request IDs before database-backed context lookup', async () => {
    arrange({ ...body, requestId: 'short' });

    const response = await POST(request());

    expect(response.status).toBe(400);
    expect(mocks.loadChatwootCartContext).not.toHaveBeenCalled();
  });

  it('returns invalid_context when the signed session does not verify', async () => {
    arrange();
    mocks.verifyChatwootSessionCapability.mockRejectedValueOnce(
      new mocks.ChatwootCommerceContextError('invalid_context')
    );

    const response = await POST(request());

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      accepted: false,
      code: 'invalid_context',
    });
    expect(mocks.checkCartQuota).not.toHaveBeenCalled();
  });

  it('requires refresh when the client version is ahead of the cart snapshot', async () => {
    arrange(body, 11);

    const response = await POST(request());

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      accepted: false,
      code: 'refresh_required',
    });
    expect(mocks.checkCartQuota).not.toHaveBeenCalled();
  });

  it('returns quota exhaustion before canonical cart mutation', async () => {
    arrange();
    mocks.checkCartQuota.mockResolvedValueOnce({ allowed: false });

    const response = await POST(request());

    expect(response.status).toBe(429);
    expect(mocks.createCartScopedClient).not.toHaveBeenCalled();
  });

  it('maps a cart RPC authorization rejection to forbidden', async () => {
    arrange();
    mocks.rpc.mockResolvedValueOnce({
      data: { ok: false, code: 'unauthorized' },
    });

    const response = await POST(request());

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      accepted: false,
      code: 'forbidden',
    });
  });

  it('maps a server-resolved unavailable catalog item to not_addable', async () => {
    arrange();

    const response = await POST(request());

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      accepted: false,
      code: 'not_addable',
    });
    expect(mocks.createCartScopedClient).toHaveBeenCalledOnce();
  });
});
