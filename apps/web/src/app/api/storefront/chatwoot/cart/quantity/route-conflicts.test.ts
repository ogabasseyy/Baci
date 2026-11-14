import { NextRequest } from 'next/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  checkCartQuota: vi.fn(async () => ({ allowed: true })),
  checkCsrfProtection: vi.fn(async () => ({ valid: true })),
  createCartScopedClient: vi.fn(() => ({ rpc: vi.fn() })),
  getCart: vi.fn(),
  getCartProofEnvironment: vi.fn(() => 'test'),
  issueCartSessionProof: vi.fn(() => 'renewed-proof'),
  cartSessionCookieMaxAge: vi.fn(() => 3600),
  loadLiveGrantOperations: vi.fn(async () => ({
    allowedOperations: ['set_quantity', 'remove'],
    grantExpiresAt: '2026-11-20T00:00:00.000Z',
  })),
  loadChatwootCartContext: vi.fn(),
  mutateCart: vi.fn(),
  readCartJsonBody: vi.fn(),
  hashCartSessionProof: vi.fn(() => 'c'.repeat(64)),
  renewChatwootSessionCapability: vi.fn(async () => 'renewed-chatwoot-session'),
  upgradeLegacySessionPrincipal: vi.fn(),
  verifyChatwootSessionCapability: vi.fn(),
}));

vi.mock('@/lib/cart/request-quota', () => ({
  checkCartQuota: mocks.checkCartQuota,
}));
vi.mock('@/lib/cart/request-context', () => ({
  readCartJsonBody: mocks.readCartJsonBody,
}));
vi.mock('@/lib/cart/grant-operations', () => ({
  loadLiveGrantOperations: mocks.loadLiveGrantOperations,
  upgradeLegacySessionPrincipal: mocks.upgradeLegacySessionPrincipal,
}));
vi.mock('@/lib/cart/cart-runtime-env', () => ({
  getCartProofEnvironment: mocks.getCartProofEnvironment,
}));
vi.mock('@/lib/cart/session-proof', () => ({
  cartSessionCookieMaxAge: mocks.cartSessionCookieMaxAge,
  issueCartSessionProof: mocks.issueCartSessionProof,
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
  hashCartSessionProof: mocks.hashCartSessionProof,
  renewChatwootSessionCapability: mocks.renewChatwootSessionCapability,
  verifyChatwootSessionCapability: mocks.verifyChatwootSessionCapability,
}));

import { POST } from './route';

const principal = {
  allowedOperations: ['set_quantity', 'remove'],
  cartId: '6df442af-4d21-4f4f-9f0b-607400000002',
  grantId: '6df442af-4d21-4f4f-9f0b-607400000003',
  merchantId: '6df442af-4d21-4f4f-9f0b-607400000001',
  principalId: '6df442af-4d21-4f4f-9f0b-607400000004',
  expiresAt: '2026-11-20T00:00:00.000Z',
  operationsClaimPresent: true,
  scope: 'session',
};
const cart = {
  cartId: principal.cartId,
  merchantId: principal.merchantId,
  version: 12,
  expiresAt: '2026-11-30T00:00:00.000Z',
  lines: [{ id: '11111111-1111-4111-8111-111111111111', quantity: 2 }],
};
const state = {
  cartId: principal.cartId,
  cartSessionSha256: 'a'.repeat(64),
  cartVersion: cart.version,
  grantId: principal.grantId,
  inboxId: 74,
  merchantId: principal.merchantId,
  origin: 'https://shop.example.com',
  principalId: principal.principalId,
  websiteToken: 'synthetic-widget-token-123456',
};
const binding = {
  inboxId: 74,
  merchantId: principal.merchantId,
  origin: 'https://shop.example.com',
  websiteToken: 'synthetic-widget-token-123456',
};
const body = {
  cartVersion: 12,
  conversationId: 905,
  expectedQuantity: 2,
  lineId: '11111111-1111-4111-8111-111111111111',
  quantity: 3,
  requestId: 'quantity-0001',
  sessionToken: 'baci.signed.session.capability',
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

describe('Chatwoot shared-cart quantity route', () => {
  afterEach(() => vi.clearAllMocks());

  function arrange(input = body, snapshot = cart) {
    mocks.getCart.mockResolvedValue({ ok: true, cart: snapshot });
    mocks.readCartJsonBody.mockResolvedValue({ ok: true, body: input });
    mocks.loadChatwootCartContext.mockResolvedValue({
      ok: true,
      binding,
      cart: snapshot,
      principal,
      state: { ...state, cartVersion: snapshot.version },
    });
    mocks.upgradeLegacySessionPrincipal.mockResolvedValue(principal);
    mocks.verifyChatwootSessionCapability.mockResolvedValue({
      conversationId: 905,
      sessionExpiresAt: 1_799_000_000,
    });
    mocks.mutateCart.mockResolvedValue({
      ok: true,
      operationId: input.requestId,
      replayed: false,
      cart: {
        cartId: principal.cartId,
        expiresAt: snapshot.expiresAt,
        merchantId: principal.merchantId,
        version: snapshot.version + 1,
      },
    });
  }

  it('maps quantity zero to the explicit remove command', async () => {
    arrange({ ...body, quantity: 0 });
    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(mocks.mutateCart).toHaveBeenCalledWith(
      { client: expect.anything(), principal },
      {
        command: {
          lineId: '11111111-1111-4111-8111-111111111111',
          type: 'remove',
        },
        expectedVersion: 12,
        operationId: 'quantity-0001',
      }
    );
  });

  it('requires a refresh when the reviewed line is missing before removal', async () => {
    arrange(body, {
      ...cart,
      lines: [],
    });
    const response = await POST(request());

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      accepted: false,
      code: 'refresh_required',
    });
    expect(mocks.mutateCart).not.toHaveBeenCalled();
  });

  it('rejects a current-version line or quantity mismatch before mutation', async () => {
    arrange({ ...body, expectedQuantity: 1 });
    const response = await POST(request());

    expect(response.status).toBe(409);
    expect(mocks.mutateCart).not.toHaveBeenCalled();
  });

  it('passes an older exact operation to the atomic service for replay reconciliation', async () => {
    const staleBody = { ...body, cartVersion: 11 };
    arrange(staleBody, { ...cart, version: 13, lines: [] });
    mocks.mutateCart.mockResolvedValue({
      ok: true,
      operationId: staleBody.requestId,
      replayed: true,
      currentVersion: 13,
      cart: { expiresAt: cart.expiresAt, version: 13 },
    });
    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(mocks.mutateCart).toHaveBeenCalledWith(
      { client: expect.anything(), principal },
      expect.objectContaining({
        expectedVersion: 11,
        operationId: 'quantity-0001',
      })
    );
    await expect(response.json()).resolves.toMatchObject({
      accepted: true,
      cartVersion: 13,
      replayed: true,
    });
  });

  it('recovers a replay from the live snapshot when the RPC omits its version', async () => {
    arrange({ ...body, cartVersion: 11 }, { ...cart, version: 15, lines: [] });
    mocks.mutateCart.mockResolvedValue({
      ok: true,
      operationId: body.requestId,
      replayed: true,
      cart: { expiresAt: cart.expiresAt, version: 13 },
    });

    const response = await POST(request());
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({
      accepted: true,
      cartVersion: 15,
      replayed: true,
    });
    expect(mocks.getCart).toHaveBeenCalledOnce();
  });

  it('maps idempotency payload mismatch and new stale requests to refresh-required', async () => {
    arrange({ ...body, cartVersion: 11 });
    mocks.mutateCart.mockResolvedValue({
      ok: false,
      code: 'idempotency_conflict',
    });
    const response = await POST(request());

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      accepted: false,
      code: 'refresh_required',
    });
  });

  it('maps a new stale command to refresh-required without exposing cart data', async () => {
    arrange({ ...body, cartVersion: 11 });
    mocks.mutateCart.mockResolvedValue({
      ok: false,
      code: 'version_conflict',
      cart: { version: 13, lines: [{ id: 'secret-line' }] },
    });
    const response = await POST(request());

    expect(response.status).toBe(409);
    const payload = await response.json();
    expect(payload).toEqual({
      accepted: false,
      code: 'refresh_required',
    });
    expect(JSON.stringify(payload)).not.toContain('secret-line');
  });

  it.each([
    'expired',
    'not_found',
  ] as const)('reports a terminal cart state for %s without suggesting refresh', async (code) => {
    arrange();
    mocks.mutateCart.mockResolvedValueOnce({ ok: false, code });

    const response = await POST(request());

    expect(response.status).toBe(410);
    await expect(response.json()).resolves.toEqual({
      accepted: false,
      code: 'cart_expired',
    });
  });

  it('preserves invalid-item and unauthorized error semantics', async () => {
    arrange();
    mocks.mutateCart.mockResolvedValueOnce({ ok: false, code: 'invalid_item' });
    const invalidItemResponse = await POST(request());
    expect(invalidItemResponse.status).toBe(400);
    await expect(invalidItemResponse.json()).resolves.toEqual({
      accepted: false,
      code: 'invalid_request',
    });

    arrange();
    mocks.mutateCart.mockResolvedValueOnce({ ok: false, code: 'unauthorized' });
    const unauthorizedResponse = await POST(request());
    expect(unauthorizedResponse.status).toBe(403);
    await expect(unauthorizedResponse.json()).resolves.toEqual({
      accepted: false,
      code: 'forbidden',
    });
  });

  it('rejects request IDs shorter than the shared cart command floor', async () => {
    arrange({ ...body, requestId: 'short' });
    const response = await POST(request());

    expect(response.status).toBe(400);
    expect(mocks.loadChatwootCartContext).not.toHaveBeenCalled();
    expect(mocks.mutateCart).not.toHaveBeenCalled();
  });
});
