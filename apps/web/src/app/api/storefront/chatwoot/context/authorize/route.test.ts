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
  rebindChatwootSessionCapability: vi.fn(),
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
  rebindChatwootSessionCapability: mocks.rebindChatwootSessionCapability,
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
const cart = {
  cartId: state.cartId,
  merchantId: binding.merchantId,
  state: 'active',
  version: 12,
  currency: 'NGN',
  subtotalMinor: 250000,
  totalMinor: 250000,
  estimatedTotals: false,
  expiresAt: '2026-11-08T12:00:00.000Z',
  checkoutSessionId: 'must-not-leak',
  lines: [
    {
      id: 'server-line-1',
      item: { productId: 'server-product-1' },
      quantity: 2,
      unitPriceMinor: 125000,
      lineTotalMinor: 250000,
      voucherToken: 'must-not-leak-either',
    },
  ],
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
      cart,
      productNames: { 'server-product-1': 'Canonical Server Phone' },
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
    expect(mocks.loadChatwootCartContext).toHaveBeenCalledWith(
      expect.any(NextRequest),
      { includeProductNames: false }
    );
  });

  it('returns only the canonical minimal cart projection when explicitly requested', async () => {
    mocks.loadChatwootCartContext.mockResolvedValue({
      ok: true,
      binding,
      state,
      cart,
      productNames: { 'server-product-1': 'Canonical Server Phone' },
    });
    mocks.readCartJsonBody.mockResolvedValue({
      ok: true,
      body: {
        sessionToken: 'baci.signed.session.capability',
        includeCartSnapshot: true,
      },
    });
    mocks.verifyChatwootSessionCapability.mockResolvedValue({
      conversationId: 905,
      sessionExpiresAt: 1_799_000_000,
    });

    const response = await POST(request());
    const body = await response.json();
    expect(mocks.loadChatwootCartContext).toHaveBeenCalledWith(
      expect.any(NextRequest),
      { includeProductNames: true }
    );
    expect(body.cartSnapshot).toEqual({
      cartVersion: 12,
      currency: 'NGN',
      estimatedTotals: false,
      items: [
        {
          lineId: 'server-line-1',
          name: 'Canonical Server Phone',
          productId: 'server-product-1',
          variantId: null,
          condition: null,
          quantity: 2,
          unitPriceMinor: 125000,
          lineTotalMinor: 250000,
        },
      ],
      itemsSubtotalMinor: 250000,
    });
    expect(JSON.stringify(body)).not.toContain('must-not-leak');
    expect(JSON.stringify(body)).not.toContain('voucherToken');
  });

  it('rebinds an old signed session only to the current proof-bound cart', async () => {
    mocks.loadChatwootCartContext.mockResolvedValue({
      ok: true,
      binding,
      state: { ...state, cartSessionSha256: 'c'.repeat(64), cartVersion: 13 },
      cart: { ...cart, version: 13 },
    });
    mocks.readCartJsonBody.mockResolvedValue({
      ok: true,
      body: { sessionToken: 'previously-signed-session' },
    });
    mocks.verifyChatwootSessionCapability.mockRejectedValue(
      new mocks.ChatwootCommerceContextError('invalid_context')
    );
    mocks.rebindChatwootSessionCapability.mockResolvedValue({
      conversationId: 905,
      sessionExpiresAt: 1_799_000_000,
      sessionToken: 'rebound-session-token',
    });

    const response = await POST(request());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      authorized: true,
      conversationId: 905,
      sessionExpiresAt: 1_799_000_000,
      sessionToken: 'rebound-session-token',
    });
    expect(mocks.rebindChatwootSessionCapability).toHaveBeenCalledWith({
      binding,
      sessionToken: 'previously-signed-session',
      state: { ...state, cartSessionSha256: 'c'.repeat(64), cartVersion: 13 },
    });
  });

  it('fails closed when an opted-in cart cannot be safely projected', async () => {
    mocks.loadChatwootCartContext.mockResolvedValue({
      ok: true,
      binding,
      state,
      cart: { ...cart, subtotalMinor: 1 },
      productNames: { 'server-product-1': 'Canonical Server Phone' },
    });
    mocks.readCartJsonBody.mockResolvedValue({
      ok: true,
      body: {
        sessionToken: 'baci.signed.session.capability',
        includeCartSnapshot: true,
      },
    });
    mocks.verifyChatwootSessionCapability.mockResolvedValue({
      conversationId: 905,
      sessionExpiresAt: 1_799_000_000,
    });

    const response = await POST(request());

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      code: 'temporarily_unavailable',
    });
  });

  it('returns an empty canonical snapshot for an empty cart', async () => {
    mocks.loadChatwootCartContext.mockResolvedValue({
      ok: true,
      binding,
      state,
      cart: { ...cart, lines: [], subtotalMinor: 0, totalMinor: 0 },
    });
    mocks.readCartJsonBody.mockResolvedValue({
      ok: true,
      body: {
        sessionToken: 'baci.signed.session.capability',
        includeCartSnapshot: true,
      },
    });
    mocks.verifyChatwootSessionCapability.mockResolvedValue({
      conversationId: 905,
      sessionExpiresAt: 1_799_000_000,
    });

    const response = await POST(request());
    const body = await response.json();

    expect(body.cartSnapshot).toEqual({
      cartVersion: 12,
      currency: 'NGN',
      estimatedTotals: false,
      items: [],
      itemsSubtotalMinor: 0,
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
    mocks.rebindChatwootSessionCapability.mockRejectedValue(
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
