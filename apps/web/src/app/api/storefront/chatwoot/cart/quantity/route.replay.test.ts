import { NextRequest } from 'next/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  checkCartQuota: vi.fn(async () => ({ allowed: true })),
  checkCsrfProtection: vi.fn(async () => ({ valid: true })),
  createCartScopedClient: vi.fn(() => ({ rpc: vi.fn() })),
  getCart: vi.fn(),
  getCartProofEnvironment: vi.fn(() => 'test'),
  issueCartSessionProof: vi.fn(
    (_claims: unknown, _options: unknown) => 'proof'
  ),
  cartSessionCookieMaxAge: vi.fn(() => 3600),
  loadLiveGrantOperations: vi.fn(async () => ({
    allowedOperations: ['set_quantity', 'remove'],
    grantExpiresAt: '2026-11-25T00:00:00.000Z',
  })),
  loadChatwootCartContext: vi.fn(),
  mutateCart: vi.fn(),
  readCartJsonBody: vi.fn(),
  hashCartSessionProof: vi.fn(() => 'c'.repeat(64)),
  renewChatwootSessionCapability: vi.fn(async () => 'renewed-session'),
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
  ChatwootCommerceContextError: class extends Error {},
  hashCartSessionProof: mocks.hashCartSessionProof,
  renewChatwootSessionCapability: mocks.renewChatwootSessionCapability,
  verifyChatwootSessionCapability: mocks.verifyChatwootSessionCapability,
}));

import { POST } from './route';

const principal = {
  allowedOperations: ['set_quantity', 'remove'],
  cartId: '6df442af-4d21-4f4f-9f0b-607400000002',
  expiresAt: '2026-11-20T00:00:00.000Z',
  grantId: '6df442af-4d21-4f4f-9f0b-607400000003',
  merchantId: '6df442af-4d21-4f4f-9f0b-607400000001',
  operationsClaimPresent: true,
  principalId: '6df442af-4d21-4f4f-9f0b-607400000004',
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
const body = {
  cartVersion: 12,
  conversationId: 905,
  expectedQuantity: 2,
  lineId: '11111111-1111-4111-8111-111111111111',
  quantity: 3,
  requestId: 'quantity-replay-01',
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

function arrange() {
  mocks.readCartJsonBody.mockResolvedValue({ ok: true, body });
  mocks.loadChatwootCartContext.mockResolvedValue({
    ok: true,
    binding: {
      inboxId: state.inboxId,
      merchantId: state.merchantId,
      origin: state.origin,
      websiteToken: state.websiteToken,
    },
    cart,
    principal,
    state,
  });
  mocks.upgradeLegacySessionPrincipal.mockResolvedValue(principal);
  mocks.verifyChatwootSessionCapability.mockResolvedValue({
    conversationId: 905,
  });
}

describe('Chatwoot cart mutation replay', () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  it('renews proof from the live cart expiry and version, not the stored receipt', async () => {
    arrange();
    const liveCart = {
      ...cart,
      version: 15,
      expiresAt: '2026-11-18T00:00:00.000Z',
    };
    mocks.getCart.mockResolvedValue({ ok: true, cart: liveCart });
    mocks.mutateCart.mockResolvedValue({
      ok: true,
      operationId: body.requestId,
      replayed: true,
      currentVersion: 15,
      cart: { version: 13, expiresAt: cart.expiresAt },
    });

    const response = await POST(request());
    expect(await response.json()).toMatchObject({
      accepted: true,
      cartVersion: 15,
      replayed: true,
    });
    expect(mocks.issueCartSessionProof.mock.calls[0]?.[0]).toMatchObject({
      grantExpiresAt: liveCart.expiresAt,
    });
  });

  it('returns refresh_required when the cart locks between read and mutation', async () => {
    arrange();
    mocks.mutateCart.mockResolvedValue({ ok: false, code: 'cart_locked' });
    const response = await POST(request());
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      accepted: false,
      code: 'refresh_required',
    });
  });

  it('logs a live grant refresh failure and does not reissue stale operations', async () => {
    arrange();
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const liveCart = {
      ...cart,
      version: 13,
      expiresAt: '2026-11-18T00:00:00.000Z',
    };
    mocks.getCart.mockResolvedValue({ ok: true, cart: liveCart });
    mocks.loadLiveGrantOperations.mockRejectedValue(
      new Error('private provider details')
    );
    mocks.mutateCart.mockResolvedValue({
      ok: true,
      operationId: body.requestId,
      replayed: true,
      currentVersion: liveCart.version,
      cart: { version: 13, expiresAt: cart.expiresAt },
    });

    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(log).toHaveBeenCalledWith(
      'Chatwoot live grant refresh failed after cart mutation'
    );
    expect(log).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ message: 'private provider details' })
    );
    expect(mocks.issueCartSessionProof).not.toHaveBeenCalled();
    expect(mocks.renewChatwootSessionCapability).not.toHaveBeenCalled();
    expect(await response.json()).not.toHaveProperty('sessionToken');
    expect(response.headers.get('set-cookie')).toBeNull();
  });

  it('fails closed when the replay snapshot read throws', async () => {
    arrange();
    mocks.getCart.mockRejectedValue(new Error('private repository details'));
    mocks.mutateCart.mockResolvedValue({
      ok: true,
      operationId: body.requestId,
      replayed: true,
      currentVersion: 15,
      cart: { version: 13, expiresAt: cart.expiresAt },
    });

    const response = await POST(request());

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      accepted: false,
      code: 'temporarily_unavailable',
    });
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('set-cookie')).toBeNull();
  });
});
