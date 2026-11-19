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
  input,
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

describe('commitChatwootCartAdd failures', () => {
  it('reloads when the request version is ahead of the loaded cart', async () => {
    const ahead = { ...input, cartVersion: 13 };
    mocks.getCart.mockResolvedValueOnce({ ok: true, cart: cart(13) });

    await run(ahead);

    expect(mocks.rpc).toHaveBeenCalledOnce();
  });

  it('requires refresh when the reloaded cart is still behind', async () => {
    mocks.getCart.mockResolvedValueOnce({ ok: true, cart: cart(12) });

    const { body, response } = await run({ cartVersion: 13 });

    expect(response.status).toBe(409);
    expect(body).toEqual({ accepted: false, code: 'refresh_required' });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('requires refresh when the reloaded cart belongs to another merchant', async () => {
    mocks.getCart.mockResolvedValueOnce({
      ok: true,
      cart: cart(13, { merchantId: 'other' }),
    });

    const { response } = await run({ cartVersion: 13 });

    expect(response.status).toBe(409);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('refuses when the live grant lacks the add operation', async () => {
    mocks.loadLiveGrantOperations.mockResolvedValue({
      allowedOperations: ['quantity'],
      grantExpiresAt: '2026-11-20T00:00:00.000Z',
    });

    const { body, response } = await run();

    expect(response.status).toBe(403);
    expect(body.code).toBe('forbidden');
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('refuses when the principal lacks the add operation', async () => {
    mocks.upgradeLegacySessionPrincipal.mockResolvedValue({
      ...principal,
      allowedOperations: ['quantity'],
    });

    const { response } = await run();

    expect(response.status).toBe(403);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('refuses when the legacy principal cannot be upgraded', async () => {
    mocks.upgradeLegacySessionPrincipal.mockResolvedValue(null);

    const { response } = await run();

    expect(response.status).toBe(403);
  });

  it.each([
    [
      'client creation',
      () =>
        mocks.createCartScopedClient.mockImplementation(() => {
          throw new Error('x');
        }),
    ],
    [
      'principal upgrade',
      () =>
        mocks.upgradeLegacySessionPrincipal.mockRejectedValue(new Error('x')),
    ],
    [
      'grant lookup',
      () => mocks.loadLiveGrantOperations.mockRejectedValue(new Error('x')),
    ],
    ['rpc throw', () => mocks.rpc.mockRejectedValue(new Error('x'))],
    [
      'rpc error',
      () => mocks.rpc.mockResolvedValue({ error: { message: 'x' } }),
    ],
    ['malformed rpc data', () => mocks.rpc.mockResolvedValue({ data: 'oops' })],
    ['missing ok flag', () => mocks.rpc.mockResolvedValue({ data: {} })],
    [
      'final cart reload',
      () => mocks.getCart.mockRejectedValue(new Error('x')),
    ],
    [
      'foreign final cart',
      () =>
        mocks.getCart.mockResolvedValue({
          ok: true,
          cart: cart(13, { cartId: 'other' }),
        }),
    ],
  ])('answers 503 when %s fails', async (_name, arrange) => {
    arrange();

    const { body, response } = await run();

    expect(response.status).toBe(503);
    expect(body).toEqual({ accepted: false, code: 'temporarily_unavailable' });
  });

  it.each([
    ['expired', 410, 'cart_expired'],
    ['not_found', 410, 'cart_expired'],
    ['cart_locked', 409, 'cart_locked'],
    ['version_conflict', 409, 'refresh_required'],
    ['idempotency_conflict', 409, 'idempotency_conflict'],
    ['invalid_item', 409, 'not_addable'],
    ['unauthorized', 403, 'forbidden'],
    ['something_else', 503, 'temporarily_unavailable'],
  ])('maps rpc code %s to %i %s', async (code, status, mapped) => {
    mocks.rpc.mockResolvedValue({ data: { ok: false, code } });

    const { body, response } = await run();

    expect(response.status).toBe(status);
    expect(body).toEqual({ accepted: false, code: mapped });
  });

  it('answers 503 when a rejection carries no code', async () => {
    mocks.rpc.mockResolvedValue({ data: { ok: false } });

    const { response } = await run();

    expect(response.status).toBe(503);
  });
});
