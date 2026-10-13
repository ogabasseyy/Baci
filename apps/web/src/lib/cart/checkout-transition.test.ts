import { describe, expect, it, vi } from 'vitest';
import { prepareCartCheckout } from './checkout-transition';
import type { CartPrincipal } from './principal';

const MERCHANT_ID = '11111111-1111-4111-8111-111111111111';
const CART_ID = '22222222-2222-4222-8222-222222222222';
const PRODUCT_ID = '33333333-3333-4333-8333-333333333333';
const SESSION_ID = '44444444-4444-4444-8444-444444444444';

function sessionPrincipal(): CartPrincipal {
  return {
    allowedOperations: ['add', 'set_quantity', 'remove', 'clear'],
    cartId: CART_ID,
    expiresAt: '2026-10-13T04:00:00Z',
    grantId: '55555555-5555-4555-8555-555555555555',
    merchantId: MERCHANT_ID,
    principalId: 'guest-a1',
    scope: 'session',
  };
}

function rawSnapshot() {
  return {
    cartId: CART_ID,
    cartVersion: 3,
    checkoutSessionId: SESSION_ID,
    currency: 'NGN',
    estimates: {
      currency: 'NGN',
      lineCount: 2,
      subtotalMinor: 81000,
      unavailableCount: 0,
    },
    generation: 1,
    lines: [
      {
        assuranceRate: null,
        available: true,
        condition: null,
        effectiveUnitPriceMinor: 25000,
        hasAssurance: false,
        id: 'aaaaaaaa-aaaa-4aaa-8aaa-000000000001',
        lastUnitPriceMinor: 25000,
        manageStock: true,
        negotiatedUnitPriceMinor: null,
        negotiationInvalidated: false,
        negotiationStatus: null,
        options: {},
        priceChanged: false,
        productId: PRODUCT_ID,
        quantity: 1,
        stockQty: 10,
        unavailableReason: null,
        validatedUnitPriceMinor: 25000,
        variantId: null,
        voucherAwardId: null,
        voucherToken: null,
      },
      {
        assuranceRate: null,
        available: true,
        condition: null,
        effectiveUnitPriceMinor: 28000,
        hasAssurance: false,
        id: 'aaaaaaaa-aaaa-4aaa-8aaa-000000000002',
        lastUnitPriceMinor: 30000,
        manageStock: true,
        negotiatedUnitPriceMinor: 28000,
        negotiationInvalidated: false,
        negotiationStatus: 'accepted',
        options: {},
        priceChanged: false,
        productId: '55555555-5555-4555-8555-555555555555',
        quantity: 2,
        stockQty: 3,
        unavailableReason: null,
        validatedUnitPriceMinor: 30000,
        variantId: '77777777-0000-4000-8000-000000000001',
        voucherAwardId: null,
        voucherToken: null,
      },
    ],
    merchantId: MERCHANT_ID,
  };
}

function clientReturning(value: unknown, error: unknown = null) {
  return { rpc: vi.fn().mockResolvedValue({ data: value, error }) };
}

describe('prepareCartCheckout', () => {
  it('returns the authoritative snapshot with the session reference', async () => {
    const client = clientReturning({
      code: null,
      ok: true,
      replayed: false,
      sessionReused: false,
      snapshot: rawSnapshot(),
    });

    const result = await prepareCartCheckout(
      { client: client as never, principal: sessionPrincipal() },
      { cartId: CART_ID, expectedVersion: 3, operationId: 'prep-op-1' }
    );

    expect(client.rpc).toHaveBeenCalledWith('commerce_cart_prepare_checkout', {
      p_cart_id: CART_ID,
      p_expected_version: 3,
      p_operation_id: 'prep-op-1',
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.replayed).toBe(false);
      expect(result.sessionReused).toBe(false);
      expect(result.snapshot.checkoutSessionId).toBe(SESSION_ID);
      expect(result.snapshot.generation).toBe(1);
      expect(result.snapshot.cartVersion).toBe(3);
      expect(result.snapshot.lines).toHaveLength(2);
      expect(result.snapshot.estimates.subtotalMinor).toBe(81000);
      expect(result.snapshot.lines[1]?.effectiveUnitPriceMinor).toBe(28000);
    }
  });

  it('surfaces reuse and replay flags without refetching', async () => {
    const client = clientReturning({
      code: null,
      ok: true,
      replayed: true,
      sessionReused: true,
      snapshot: rawSnapshot(),
    });

    const result = await prepareCartCheckout(
      { client: client as never, principal: sessionPrincipal() },
      { cartId: CART_ID, expectedVersion: 3, operationId: 'prep-op-1' }
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.replayed).toBe(true);
      expect(result.sessionReused).toBe(true);
      expect(result.snapshot.checkoutSessionId).toBe(SESSION_ID);
    }
  });

  it('passes refresh failures through with the live version', async () => {
    const client = clientReturning({
      code: 'refresh_required',
      currentVersion: 4,
      ok: false,
      replayed: false,
      snapshot: null,
    });

    const result = await prepareCartCheckout(
      { client: client as never, principal: sessionPrincipal() },
      { cartId: CART_ID, expectedVersion: 3, operationId: 'prep-op-stale' }
    );

    expect(result).toMatchObject({
      code: 'refresh_required',
      currentVersion: 4,
      ok: false,
    });
  });

  it('rejects a bootstrap principal without a cart RPC call', async () => {
    const client = clientReturning(null);
    const principal: CartPrincipal = {
      ...sessionPrincipal(),
      cartId: null,
      grantId: null,
      scope: 'bootstrap',
    };

    const result = await prepareCartCheckout(
      { client: client as never, principal },
      { cartId: CART_ID, expectedVersion: 3, operationId: 'prep-op-1' }
    );

    expect(result).toMatchObject({ code: 'unauthorized', ok: false });
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it('rejects a cart id outside the principal without a cart RPC call', async () => {
    const client = clientReturning(null);

    const result = await prepareCartCheckout(
      { client: client as never, principal: sessionPrincipal() },
      {
        cartId: '99999999-9999-4999-8999-999999999999',
        expectedVersion: 3,
        operationId: 'prep-op-1',
      }
    );

    expect(result).toMatchObject({ code: 'unauthorized', ok: false });
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it('rejects malformed versions and operation ids without a cart RPC call', async () => {
    const client = clientReturning(null);
    const deps = {
      client: client as never,
      principal: sessionPrincipal(),
    };

    for (const input of [
      { cartId: CART_ID, expectedVersion: 0, operationId: 'prep-op-1' },
      { cartId: CART_ID, expectedVersion: 1.5, operationId: 'prep-op-1' },
      { cartId: CART_ID, expectedVersion: 3, operationId: '' },
      { cartId: CART_ID, expectedVersion: 3, operationId: '   ' },
      { cartId: CART_ID, expectedVersion: 3, operationId: 'x'.repeat(129) },
    ]) {
      expect(await prepareCartCheckout(deps, input)).toMatchObject({
        code: 'invalid_item',
        ok: false,
      });
    }
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it('maps transport failures to temporarily_unavailable', async () => {
    const client = clientReturning(null, {
      code: 'XX000',
      message: 'connection reset',
    });

    const result = await prepareCartCheckout(
      { client: client as never, principal: sessionPrincipal() },
      { cartId: CART_ID, expectedVersion: 3, operationId: 'prep-op-1' }
    );

    expect(result).toMatchObject({
      code: 'temporarily_unavailable',
      ok: false,
    });
  });

  it('fails closed on a malformed snapshot', async () => {
    const malformed = rawSnapshot() as Record<string, unknown>;
    delete malformed.lines;
    const client = clientReturning({
      code: null,
      ok: true,
      replayed: false,
      sessionReused: false,
      snapshot: malformed,
    });

    const result = await prepareCartCheckout(
      { client: client as never, principal: sessionPrincipal() },
      { cartId: CART_ID, expectedVersion: 3, operationId: 'prep-op-1' }
    );

    expect(result).toMatchObject({
      code: 'temporarily_unavailable',
      ok: false,
    });
  });

  it('fails closed on a malformed snapshot line', async () => {
    const snapshot = rawSnapshot();
    snapshot.lines[0] = {
      ...(snapshot.lines[0] as Record<string, unknown>),
      validatedUnitPriceMinor: 'not-a-number',
    } as unknown as (typeof snapshot.lines)[number];
    const client = clientReturning({
      code: null,
      ok: true,
      replayed: false,
      sessionReused: false,
      snapshot,
    });

    const result = await prepareCartCheckout(
      { client: client as never, principal: sessionPrincipal() },
      { cartId: CART_ID, expectedVersion: 3, operationId: 'prep-op-1' }
    );

    expect(result).toMatchObject({
      code: 'temporarily_unavailable',
      ok: false,
    });
  });
});
