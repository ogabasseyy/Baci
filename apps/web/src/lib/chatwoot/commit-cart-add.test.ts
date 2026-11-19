import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createCartScopedClient: vi.fn(),
  getCart: vi.fn(),
  issueCartSessionProof: vi.fn(() => 'signed-proof'),
  loadLiveGrantOperations: vi.fn(),
  renewChatwootSessionCapability: vi.fn(),
  resolveChatwootCartProofExpiry: vi.fn(),
  rpc: vi.fn(),
  setCartSessionCookie: vi.fn(),
  upgradeLegacySessionPrincipal: vi.fn(),
}));

vi.mock('@/lib/cart/cart-runtime-env', () => ({
  getCartProofEnvironment: () => 'test',
}));
vi.mock('@/lib/cart/chatwoot-proof-expiry', () => ({
  resolveChatwootCartProofExpiry: mocks.resolveChatwootCartProofExpiry,
}));
vi.mock('@/lib/cart/grant-operations', () => ({
  loadLiveGrantOperations: mocks.loadLiveGrantOperations,
  upgradeLegacySessionPrincipal: mocks.upgradeLegacySessionPrincipal,
}));
vi.mock('@/lib/cart/response', () => ({
  setCartSessionCookie: mocks.setCartSessionCookie,
}));
vi.mock('@/lib/cart/scoped-client', () => ({
  createCartScopedClient: mocks.createCartScopedClient,
}));
vi.mock('@/lib/cart/service', () => ({ getCart: mocks.getCart }));
vi.mock('@/lib/cart/session-proof', () => ({
  cartSessionCookieMaxAge: () => 3600,
  issueCartSessionProof: mocks.issueCartSessionProof,
}));
vi.mock('@/lib/chatwoot/commerce-context', () => ({
  hashCartSessionProof: () => 'c'.repeat(64),
  renewChatwootSessionCapability: mocks.renewChatwootSessionCapability,
}));

import { commitChatwootCartAdd } from './commit-cart-add';

import {
  cart,
  cartId,
  input,
  merchantId,
  principal,
  run as runWith,
} from './commit-cart-add.test-support';

const run = (overrides: Parameters<typeof runWith>[1] = {}) =>
  runWith(commitChatwootCartAdd, overrides);

beforeEach(() => {
  mocks.createCartScopedClient.mockReturnValue({ rpc: mocks.rpc });
  mocks.upgradeLegacySessionPrincipal.mockResolvedValue(principal);
  mocks.loadLiveGrantOperations.mockResolvedValue({
    allowedOperations: ['add', 'quantity'],
    grantExpiresAt: '2026-11-20T00:00:00.000Z',
  });
  mocks.rpc.mockResolvedValue({ data: { ok: true } });
  mocks.getCart.mockResolvedValue({ ok: true, cart: cart(13) });
  mocks.resolveChatwootCartProofExpiry.mockReturnValue(
    '2026-11-20T00:00:00.000Z'
  );
  mocks.renewChatwootSessionCapability.mockResolvedValue('renewed-token');
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('commitChatwootCartAdd', () => {
  it('commits through the versioned RPC and renews the session', async () => {
    const { body, response } = await run();

    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(body).toEqual({
      accepted: true,
      cartVersion: 13,
      operationId: 'add-request-01',
      replayed: false,
      sessionToken: 'renewed-token',
    });
    expect(mocks.rpc).toHaveBeenCalledWith('commerce_cart_add_chatwoot', {
      p_cart_id: cartId,
      p_expected_version: 12,
      p_operation_id: 'add-request-01',
      p_product_slug: 'phone-13',
      p_variant_id: input.variantId,
    });
    expect(mocks.setCartSessionCookie).toHaveBeenCalledWith(
      response,
      merchantId,
      'signed-proof',
      3600
    );
  });

  it('passes a null variant when none is supplied', async () => {
    await run({ variantId: undefined });

    expect(mocks.rpc).toHaveBeenCalledWith(
      'commerce_cart_add_chatwoot',
      expect.objectContaining({ p_variant_id: null })
    );
  });

  it('accepts a replay without renewing from a stale receipt', async () => {
    mocks.rpc.mockResolvedValue({ data: { ok: true, replayed: true } });
    mocks.getCart.mockResolvedValue({ ok: true, cart: cart(14) });

    const { body } = await run();

    expect(body).toMatchObject({
      accepted: true,
      cartVersion: 14,
      replayed: true,
    });
    expect(mocks.getCart).toHaveBeenCalledTimes(2);
  });

  it('keeps an accepted replay but omits credentials when the reload fails', async () => {
    mocks.rpc.mockResolvedValue({ data: { ok: true, replayed: true } });
    mocks.getCart
      .mockResolvedValueOnce({ ok: true, cart: cart(13) })
      .mockRejectedValueOnce(new Error('network'));

    const { body, response } = await run();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      accepted: true,
      operationId: 'add-request-01',
      replayed: true,
    });
    expect(mocks.setCartSessionCookie).not.toHaveBeenCalled();
  });

  it('omits renewal when the grant refresh fails after the add', async () => {
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    mocks.loadLiveGrantOperations
      .mockResolvedValueOnce({
        allowedOperations: ['add'],
        grantExpiresAt: '2026-11-20T00:00:00.000Z',
      })
      .mockRejectedValueOnce(new Error('boom'));

    const { body } = await run();

    expect(body.accepted).toBe(true);
    expect(body.sessionToken).toBeUndefined();
    expect(mocks.setCartSessionCookie).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it('accepts the add without credentials when renewal throws', async () => {
    mocks.renewChatwootSessionCapability.mockRejectedValue(new Error('x'));

    const { body } = await run();

    expect(body.accepted).toBe(true);
    expect(body.sessionToken).toBeUndefined();
    expect(mocks.setCartSessionCookie).not.toHaveBeenCalled();
  });
});
