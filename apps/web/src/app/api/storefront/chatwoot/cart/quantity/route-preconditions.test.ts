import { NextRequest } from 'next/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  checkCartQuota: vi.fn(async () => ({ allowed: true })),
  checkCsrfProtection: vi.fn(async () => ({ valid: true })),
  createCartScopedClient: vi.fn(() => ({ rpc: vi.fn() })),
  getCart: vi.fn(),
  loadLiveGrantOperations: vi.fn(async () => ({
    allowedOperations: ['set_quantity', 'remove'],
    grantExpiresAt: '2026-11-20T00:00:00.000Z',
  })),
  loadChatwootCartContext: vi.fn(),
  mutateCart: vi.fn(),
  readCartJsonBody: vi.fn(),
  upgradeLegacySessionPrincipal: vi.fn(),
  verifyChatwootSessionCapability: vi.fn(),
}));

vi.mock('@/lib/cart/request-context', () => ({
  readCartJsonBody: mocks.readCartJsonBody,
}));
vi.mock('@/lib/cart/request-quota', () => ({
  checkCartQuota: mocks.checkCartQuota,
}));
vi.mock('@/lib/cart/grant-operations', () => ({
  loadLiveGrantOperations: mocks.loadLiveGrantOperations,
  upgradeLegacySessionPrincipal: mocks.upgradeLegacySessionPrincipal,
}));
vi.mock('@/lib/cart/scoped-client', () => ({
  createCartScopedClient: mocks.createCartScopedClient,
}));
vi.mock('@/lib/cart/service', () => ({
  getCart: mocks.getCart,
  mutateCart: mocks.mutateCart,
}));
vi.mock('@/lib/csrf', () => ({
  checkCsrfProtection: mocks.checkCsrfProtection,
}));
vi.mock('@/lib/chatwoot/cart-context', () => ({
  loadChatwootCartContext: mocks.loadChatwootCartContext,
}));
vi.mock('@/lib/chatwoot/commerce-context', () => ({
  ChatwootCommerceContextError: class ChatwootCommerceContextError extends Error {
    constructor(readonly code: string) {
      super(code);
    }
  },
  verifyChatwootSessionCapability: mocks.verifyChatwootSessionCapability,
}));

import { POST } from './route';

const merchantId = '11111111-1111-4111-8111-111111111111';
const cartId = '22222222-2222-4222-8222-222222222222';
const principal = {
  allowedOperations: [],
  cartId,
  expiresAt: '2026-11-20T00:00:00.000Z',
  grantId: '33333333-3333-4333-8333-333333333333',
  merchantId,
  operationsClaimPresent: false,
  principalId: '44444444-4444-4444-8444-444444444444',
  scope: 'session',
};
const cart = {
  cartId,
  merchantId,
  version: 12,
  expiresAt: '2026-11-30T00:00:00.000Z',
  lines: [{ id: '55555555-5555-4555-8555-555555555555', quantity: 2 }],
};
const state = {
  cartId,
  cartSessionSha256: 'a'.repeat(64),
  cartVersion: cart.version,
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
  expectedQuantity: 2,
  lineId: cart.lines[0].id,
  quantity: 3,
  requestId: 'quantity-0001',
  sessionToken: 'signed-session-capability',
};

function request() {
  return new NextRequest(
    'https://shop.example.com/api/storefront/chatwoot/cart/quantity',
    {
      method: 'POST',
      headers: { host: 'shop.example.com', origin: 'https://shop.example.com' },
    }
  );
}

function arrange(input = body) {
  mocks.readCartJsonBody.mockResolvedValue({ ok: true, body: input });
  mocks.loadChatwootCartContext.mockResolvedValue({
    ok: true,
    binding,
    cart,
    principal,
    state,
  });
  mocks.verifyChatwootSessionCapability.mockResolvedValue({
    conversationId: body.conversationId,
    sessionExpiresAt: 1_799_000_000,
  });
  mocks.upgradeLegacySessionPrincipal.mockResolvedValue({
    ...principal,
    allowedOperations: ['set_quantity', 'remove'],
    operationsClaimPresent: true,
  });
  mocks.getCart.mockResolvedValue({ ok: true, cart });
}

describe('Chatwoot quantity route preconditions', () => {
  afterEach(() => vi.clearAllMocks());

  it('rejects a legacy principal whose grant is explicitly unauthorized', async () => {
    arrange();
    mocks.upgradeLegacySessionPrincipal.mockResolvedValueOnce(null);

    const response = await POST(request());

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      accepted: false,
      code: 'forbidden',
    });
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('set-cookie')).toBeNull();
    expect(mocks.mutateCart).not.toHaveBeenCalled();
  });

  it('requires refresh for a version newer than the authorized snapshot', async () => {
    arrange({ ...body, cartVersion: cart.version + 1 });

    const response = await POST(request());

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      accepted: false,
      code: 'refresh_required',
    });
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('set-cookie')).toBeNull();
    expect(mocks.mutateCart).not.toHaveBeenCalled();
  });
});
