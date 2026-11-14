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
  createCartScopedClient: vi.fn(() => ({ rpc: vi.fn() })),
  getCart: vi.fn(async (_deps: unknown) => ({
    ok: true as const,
    cart: { cartId: 'cart', version: 1, expiresAt: 'expiry' },
  })),
  getCartProofEnvironment: vi.fn(() => 'test'),
  issueCartSessionProof: vi.fn(
    (_claims: unknown, _options: unknown) => 'renewed-proof'
  ),
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
  ChatwootCommerceContextError: mocks.ChatwootCommerceContextError,
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

  it('verifies the session before submitting a scoped versioned quantity command', async () => {
    arrange();
    const response = await POST(request());

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload).toEqual({
      accepted: true,
      cartVersion: 13,
      operationId: 'quantity-0001',
      replayed: false,
      sessionToken: 'renewed-chatwoot-session',
    });
    expect(mocks.verifyChatwootSessionCapability).toHaveBeenCalledWith({
      binding,
      sessionToken: body.sessionToken,
      state,
    });
    expect(mocks.mutateCart).toHaveBeenCalledWith(
      { client: expect.anything(), principal },
      {
        command: {
          lineId: '11111111-1111-4111-8111-111111111111',
          quantity: 3,
          type: 'set_quantity',
        },
        expectedVersion: 12,
        operationId: 'quantity-0001',
      }
    );
    expect(mocks.upgradeLegacySessionPrincipal).toHaveBeenCalledOnce();
    expect(response.headers.get('set-cookie')).toContain(
      `baci-cart-${principal.merchantId}=renewed-proof`
    );
    expect(payload).not.toHaveProperty('proof');
    expect(mocks.issueCartSessionProof).toHaveBeenCalledWith(
      expect.objectContaining({
        allowedOperations: ['set_quantity', 'remove'],
        cartId: principal.cartId,
        grantExpiresAt: principal.expiresAt,
        grantId: principal.grantId,
        merchantId: principal.merchantId,
        principalId: principal.principalId,
        scope: 'session',
      }),
      { environment: 'test' }
    );
    expect(mocks.renewChatwootSessionCapability).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionToken: body.sessionToken,
        previousState: state,
        nextState: expect.objectContaining({
          cartSessionSha256: 'c'.repeat(64),
          cartVersion: 13,
        }),
      })
    );
    expect(mocks.cartSessionCookieMaxAge).toHaveBeenCalledWith(
      '2026-11-20T00:00:00.000Z'
    );
  });

  it('rechecks a version newer than a stale context snapshot before mutation', async () => {
    arrange({ ...body, cartVersion: 13 });
    mocks.getCart.mockResolvedValueOnce({
      ok: true,
      cart: { ...cart, version: 13 },
    });
    mocks.mutateCart.mockResolvedValueOnce({
      ok: true,
      operationId: body.requestId,
      replayed: false,
      cart: { ...cart, version: 14 },
    });

    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(mocks.getCart).toHaveBeenCalledOnce();
    expect(mocks.mutateCart).toHaveBeenCalledWith(
      { client: expect.anything(), principal },
      expect.objectContaining({ expectedVersion: 13 })
    );
  });

  it('does not renew proof from a fresh mutation result with mismatched cart binding', async () => {
    arrange();
    mocks.mutateCart.mockResolvedValueOnce({
      ok: true,
      operationId: body.requestId,
      replayed: false,
      currentVersion: 13,
      cart: {
        ...cart,
        cartId: '99999999-9999-4999-8999-999999999999',
        version: 13,
      },
    });

    const response = await POST(request());
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({
      accepted: true,
      operationId: body.requestId,
      replayed: false,
    });
    expect(response.headers.get('set-cookie')).toBeNull();
    expect(mocks.issueCartSessionProof).not.toHaveBeenCalled();
    expect(mocks.renewChatwootSessionCapability).not.toHaveBeenCalled();
  });

  it.each([
    [
      'context lookup',
      () =>
        mocks.loadChatwootCartContext.mockRejectedValueOnce(
          new Error('private context error')
        ),
    ],
    [
      'cart mutation',
      () =>
        mocks.mutateCart.mockRejectedValueOnce(
          new Error('private mutation error')
        ),
    ],
  ])('returns a no-store unavailable response when %s throws', async (_label, reject) => {
    arrange();
    reject();

    const response = await POST(request());

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      accepted: false,
      code: 'temporarily_unavailable',
    });
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('set-cookie')).toBeNull();
  });

  it('returns the stable unavailable response when scoped proof creation expires', async () => {
    arrange();
    mocks.createCartScopedClient.mockImplementationOnce(() => {
      throw new Error('cart proof has expired');
    });

    const response = await POST(request());

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      accepted: false,
      code: 'temporarily_unavailable',
    });
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('set-cookie')).toBeNull();
    expect(mocks.mutateCart).not.toHaveBeenCalled();
  });
  it('keeps grant lookup failures retryable without mutating the cart', async () => {
    arrange();
    mocks.upgradeLegacySessionPrincipal.mockRejectedValueOnce(
      new Error('synthetic grant lookup failure')
    );

    const response = await POST(request());

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      accepted: false,
      code: 'temporarily_unavailable',
    });
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(mocks.mutateCart).not.toHaveBeenCalled();
  });
  it('uses upgraded live operations for a legacy cart principal', async () => {
    arrange();
    const upgraded = {
      ...principal,
      allowedOperations: ['set_quantity', 'remove'],
      operationsClaimPresent: true,
    };
    mocks.upgradeLegacySessionPrincipal.mockResolvedValue(upgraded);
    await POST(request());

    expect(mocks.mutateCart).toHaveBeenCalledWith(
      { client: expect.anything(), principal: upgraded },
      expect.objectContaining({ operationId: 'quantity-0001' })
    );
  });
  it('keeps the old proof when capability renewal fails after a committed edit', async () => {
    arrange();
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.renewChatwootSessionCapability.mockRejectedValueOnce(
      new Error('synthetic signing failure')
    );

    const response = await POST(request());
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({ accepted: true, cartVersion: 13 });
    expect(payload).not.toHaveProperty('sessionToken');
    expect(response.headers.get('set-cookie')).toBeNull();
    expect(mocks.mutateCart).toHaveBeenCalledOnce();
    expect(log).toHaveBeenCalledWith(
      'Chatwoot session renewal failed after cart commit'
    );
    expect(log).not.toHaveBeenCalledWith(
      expect.stringContaining('synthetic signing failure')
    );
    log.mockRestore();
  });

  it('accepts a committed replay without a version when the live read fails', async () => {
    arrange();
    mocks.mutateCart.mockResolvedValueOnce({
      ok: true,
      operationId: body.requestId,
      replayed: true,
      cart: { expiresAt: cart.expiresAt, version: cart.version + 1 },
    });
    mocks.getCart.mockRejectedValueOnce(
      new Error('synthetic snapshot failure')
    );

    const response = await POST(request());
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({
      accepted: true,
      operationId: body.requestId,
      replayed: true,
    });
    expect(response.headers.get('set-cookie')).toBeNull();
    expect(response.headers.get('cache-control')).toBe('private, no-store');
  });

  it('rejects a conversation mismatch before mutation', async () => {
    arrange();
    mocks.verifyChatwootSessionCapability.mockResolvedValue({
      conversationId: 906,
      sessionExpiresAt: 1_799_000_000,
    });
    const response = await POST(request());

    expect(response.status).toBe(403);
    expect(mocks.mutateCart).not.toHaveBeenCalled();
  });

  it('maps quantity zero to the scoped remove command', async () => {
    arrange({ ...body, quantity: 0 });

    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(mocks.mutateCart).toHaveBeenCalledWith(
      { client: expect.anything(), principal },
      {
        command: {
          lineId: body.lineId,
          type: 'remove',
        },
        expectedVersion: body.cartVersion,
        operationId: body.requestId,
      }
    );
  });

  it('rejects removal of a missing line without exposing cart data', async () => {
    arrange(body, { ...cart, lines: [] });

    const response = await POST(request());

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      accepted: false,
      code: 'refresh_required',
    });
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(mocks.mutateCart).not.toHaveBeenCalled();
  });

  it('checks CSRF before reading request data', async () => {
    mocks.checkCsrfProtection.mockResolvedValue({ valid: false });
    const response = await POST(request());

    expect(response.status).toBe(403);
    expect(mocks.readCartJsonBody).not.toHaveBeenCalled();
    expect(mocks.loadChatwootCartContext).not.toHaveBeenCalled();
    expect(mocks.mutateCart).not.toHaveBeenCalled();
  });
});
