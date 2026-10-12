import { describe, expect, it, vi } from 'vitest';
import type { CartPrincipal } from './principal';
import { createCart, getCart, mutateCart } from './service';

const MERCHANT_ID = '11111111-1111-4111-8111-111111111111';
const CART_ID = '22222222-2222-4222-8222-222222222222';
const PRODUCT_ID = '33333333-3333-4333-8333-333333333333';

function sessionPrincipal(): CartPrincipal {
  return {
    allowedOperations: ['add', 'set_quantity', 'remove', 'clear'],
    cartId: CART_ID,
    expiresAt: '2026-10-13T04:00:00Z',
    grantId: '33333333-3333-4333-8333-333333333333',
    merchantId: MERCHANT_ID,
    principalId: 'guest-a1',
    scope: 'session',
  };
}

function bootstrapPrincipal(): CartPrincipal {
  return {
    allowedOperations: [],
    cartId: null,
    expiresAt: '2026-10-12T04:15:00Z',
    grantId: null,
    merchantId: MERCHANT_ID,
    principalId: 'guest-new',
    scope: 'bootstrap',
  };
}

function rawState() {
  return {
    cartId: CART_ID,
    checkoutSessionId: null,
    currency: 'NGN',
    expiresAt: '2026-10-19T04:00:00Z',
    lines: [
      {
        assuranceRate: null,
        available: true,
        condition: null,
        hasAssurance: false,
        id: 'line-1',
        manageStock: false,
        negotiatedUnitPriceMinor: null,
        negotiationInvalidated: false,
        negotiationStatus: null,
        options: {},
        productId: PRODUCT_ID,
        quantity: 2,
        stockQty: null,
        unitPriceMinor: 2500,
        variantId: null,
        voucherAwardId: null,
        voucherToken: null,
      },
    ],
    merchantId: MERCHANT_ID,
    replayed: false,
    state: 'active',
    version: 2,
  };
}

function clientReturning(value: unknown, error: unknown = null) {
  return { rpc: vi.fn().mockResolvedValue({ data: value, error }) };
}

describe('getCart', () => {
  it('returns the priced snapshot for a session principal', async () => {
    const client = clientReturning({
      code: null,
      ok: true,
      replayed: false,
      state: rawState(),
    });

    const result = await getCart({
      client: client as never,
      principal: sessionPrincipal(),
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.cart.lines).toHaveLength(1);
      expect(result.cart.totalMinor).toBe(5000);
      expect(result.replayed).toBe(false);
    }
  });

  it('rejects a bootstrap principal without a cart RPC call', async () => {
    const client = clientReturning(null);

    const result = await getCart({
      client: client as never,
      principal: bootstrapPrincipal(),
    });

    expect(result).toMatchObject({ code: 'unauthorized', ok: false });
    expect(client.rpc).not.toHaveBeenCalled();
  });
});

describe('createCart', () => {
  it('creates exactly one cart for a bootstrap principal', async () => {
    const client = clientReturning({
      code: null,
      ok: true,
      replayed: false,
      state: { ...rawState(), lines: [], version: 1 },
    });

    const result = await createCart(
      { client: client as never, principal: bootstrapPrincipal() },
      { lines: [], operationId: 'create-1' }
    );

    expect(result.ok).toBe(true);
    expect(client.rpc).toHaveBeenCalledTimes(1);
  });

  it('rejects creation for a session that already has a cart', async () => {
    const client = clientReturning(null);

    const result = await createCart(
      { client: client as never, principal: sessionPrincipal() },
      { operationId: 'create-2' }
    );

    expect(result).toMatchObject({ code: 'unauthorized', ok: false });
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it('rejects invalid lines before any RPC call', async () => {
    const client = clientReturning(null);

    const result = await createCart(
      { client: client as never, principal: bootstrapPrincipal() },
      {
        lines: [{ item: { productId: '' }, quantity: 1 }],
        operationId: 'create-3',
      }
    );

    expect(result).toMatchObject({ code: 'invalid_item', ok: false });
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it('carries the server-minted grant id for session proof issuance', async () => {
    const client = clientReturning({
      code: null,
      grantId: '99999999-9999-4999-8999-999999999991',
      ok: true,
      replayed: false,
      state: { ...rawState(), lines: [], version: 1 },
    });

    const result = await createCart(
      { client: client as never, principal: bootstrapPrincipal() },
      { lines: [], operationId: 'create-4' }
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.grantId).toBe('99999999-9999-4999-8999-999999999991');
    }
  });
});

describe('mutateCart', () => {
  it('applies a valid command and prices the new snapshot', async () => {
    const client = clientReturning({
      code: null,
      ok: true,
      replayed: false,
      state: rawState(),
    });

    const result = await mutateCart(
      { client: client as never, principal: sessionPrincipal() },
      {
        command: {
          item: { productId: PRODUCT_ID },
          quantity: 2,
          type: 'add',
        },
        expectedVersion: 1,
        operationId: 'op-1',
      }
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.operationId).toBe('op-1');
      expect(result.replayed).toBe(false);
      expect(result.cart.totalMinor).toBe(5000);
    }
  });

  it('surfaces replayed outcomes without re-pricing from stale input', async () => {
    const client = clientReturning({
      code: null,
      ok: true,
      replayed: true,
      state: rawState(),
    });

    const result = await mutateCart(
      { client: client as never, principal: sessionPrincipal() },
      {
        command: { type: 'clear' },
        expectedVersion: 1,
        operationId: 'op-1',
      }
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.replayed).toBe(true);
      expect(result.cart.version).toBe(2);
    }
  });

  it('returns the current snapshot on version conflicts', async () => {
    const client = clientReturning({
      code: 'version_conflict',
      ok: false,
      replayed: false,
      state: rawState(),
    });

    const result = await mutateCart(
      { client: client as never, principal: sessionPrincipal() },
      {
        command: { lineId: 'line-1', type: 'remove' },
        expectedVersion: 1,
        operationId: 'op-stale',
      }
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('version_conflict');
      expect(result.cart?.version).toBe(2);
    }
  });

  it('rejects structurally invalid commands before any RPC call', async () => {
    const client = clientReturning(null);

    const result = await mutateCart(
      { client: client as never, principal: sessionPrincipal() },
      {
        command: {
          item: { productId: PRODUCT_ID },
          quantity: 0,
          type: 'add',
        },
        expectedVersion: 1,
        operationId: 'op-bad',
      }
    );

    expect(result).toMatchObject({ code: 'invalid_item', ok: false });
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it('rejects empty operation IDs and non-positive versions locally', async () => {
    const client = clientReturning(null);
    const deps = { client: client as never, principal: sessionPrincipal() };

    const emptyKey = await mutateCart(deps, {
      command: { type: 'clear' },
      expectedVersion: 1,
      operationId: '  ',
    });
    expect(emptyKey).toMatchObject({ code: 'invalid_item', ok: false });

    const badVersion = await mutateCart(deps, {
      command: { type: 'clear' },
      expectedVersion: 0,
      operationId: 'op-5',
    });
    expect(badVersion).toMatchObject({ code: 'invalid_item', ok: false });
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it('maps transport failures to temporarily_unavailable', async () => {
    const client = clientReturning(null, { message: 'fetch failed' });

    const result = await mutateCart(
      { client: client as never, principal: sessionPrincipal() },
      {
        command: { type: 'clear' },
        expectedVersion: 2,
        operationId: 'op-6',
      }
    );

    expect(result).toMatchObject({
      code: 'temporarily_unavailable',
      ok: false,
    });
  });
});
