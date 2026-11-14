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

  it('accepts a PostgreSQL UUID variant id with legacy RFC bits', async () => {
    arrange({
      ...body,
      variantId: '00000000-0000-0000-0000-000000000001',
    });

    const response = await POST(request());

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      accepted: false,
      code: 'not_addable',
    });
    expect(mocks.rpc).toHaveBeenCalledWith('commerce_cart_add_chatwoot', {
      p_cart_id: cartId,
      p_expected_version: 12,
      p_operation_id: body.requestId,
      p_product_slug: body.productSlug,
      p_variant_id: '00000000-0000-0000-0000-000000000001',
    });
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

  it('returns invalid_context when the conversation does not match the session', async () => {
    arrange();
    mocks.verifyChatwootSessionCapability.mockResolvedValueOnce({
      conversationId: 906,
      sessionExpiresAt: 1_799_000_000,
    });

    const response = await POST(request());

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      accepted: false,
      code: 'invalid_context',
    });
    expect(mocks.checkCartQuota).not.toHaveBeenCalled();
  });

  it('reloads the cart when the request version is ahead of the loaded snapshot', async () => {
    arrange(body, 11);
    mocks.getCart.mockResolvedValueOnce({
      ok: true,
      cart: {
        cartId,
        merchantId,
        version: 12,
        expiresAt: '2026-11-30T00:00:00.000Z',
        lines: [],
      },
    });

    const response = await POST(request());

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      accepted: false,
      code: 'not_addable',
    });
    expect(mocks.getCart).toHaveBeenCalledOnce();
    expect(mocks.rpc).toHaveBeenCalledWith('commerce_cart_add_chatwoot', {
      p_cart_id: cartId,
      p_expected_version: 12,
      p_operation_id: body.requestId,
      p_product_slug: body.productSlug,
      p_variant_id: body.variantId,
    });
  });

  it('requires refresh when the latest cart is still behind the request version', async () => {
    arrange(body, 11);
    mocks.getCart.mockResolvedValueOnce({
      ok: true,
      cart: {
        cartId,
        merchantId,
        version: 11,
        expiresAt: '2026-11-30T00:00:00.000Z',
        lines: [],
      },
    });

    const response = await POST(request());

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      accepted: false,
      code: 'refresh_required',
    });
    expect(mocks.rpc).not.toHaveBeenCalled();
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

  it('maps a version conflict to a refresh-required response', async () => {
    arrange();
    mocks.rpc.mockResolvedValueOnce({
      data: { ok: false, code: 'version_conflict' },
    });

    const response = await POST(request());

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      accepted: false,
      code: 'refresh_required',
    });
  });

  it('preserves a locked cart as a distinct checkout response', async () => {
    arrange();
    mocks.rpc.mockResolvedValueOnce({
      data: { ok: false, code: 'cart_locked' },
    });

    const response = await POST(request());

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      accepted: false,
      code: 'cart_locked',
    });
  });

  it.each([
    'expired',
    'not_found',
  ])('maps %s to an expired-cart response', async (code) => {
    arrange();
    mocks.rpc.mockResolvedValueOnce({ data: { ok: false, code } });

    const response = await POST(request());

    expect(response.status).toBe(410);
    await expect(response.json()).resolves.toEqual({
      accepted: false,
      code: 'cart_expired',
    });
  });

  it('preserves an idempotency conflict as a distinct 409 result', async () => {
    arrange();
    mocks.rpc.mockResolvedValueOnce({
      data: { ok: false, code: 'idempotency_conflict' },
    });

    const response = await POST(request());

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      accepted: false,
      code: 'idempotency_conflict',
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
