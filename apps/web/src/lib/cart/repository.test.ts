import { describe, expect, it, vi } from 'vitest';
import {
  CartRepositoryError,
  rpcCreateCart,
  rpcGetCart,
  rpcMutateCart,
} from './repository';

const CART_ID = '22222222-2222-4222-8222-222222222222';

function rawState() {
  return {
    cartId: CART_ID,
    checkoutSessionId: null,
    currency: 'NGN',
    expiresAt: '2026-10-19T04:00:00Z',
    lines: [],
    merchantId: '11111111-1111-4111-8111-111111111111',
    replayed: false,
    state: 'active',
    version: 1,
  };
}

function clientReturning(value: unknown, error: unknown = null) {
  return { rpc: vi.fn().mockResolvedValue({ data: value, error }) };
}

describe('rpcMutateCart', () => {
  it('returns the committed result from the mutation RPC', async () => {
    const client = clientReturning({
      code: null,
      ok: true,
      replayed: false,
      state: rawState(),
    });

    const result = await rpcMutateCart(client as never, {
      cartId: CART_ID,
      command: { type: 'clear' },
      expectedVersion: 1,
      operationId: 'op-1',
    });

    expect(result.ok).toBe(true);
    expect(result.replayed).toBe(false);
    expect(client.rpc).toHaveBeenCalledWith(
      'commerce_cart_mutate',
      expect.objectContaining({ p_cart_id: CART_ID })
    );
  });

  it('returns business failures without throwing', async () => {
    const client = clientReturning({
      code: 'version_conflict',
      currentVersion: 4,
      ok: false,
      replayed: false,
      state: rawState(),
    });

    const result = await rpcMutateCart(client as never, {
      cartId: CART_ID,
      command: { lineId: 'line-1', type: 'remove' },
      expectedVersion: 1,
      operationId: 'op-2',
    });

    expect(result).toMatchObject({
      code: 'version_conflict',
      currentVersion: 4,
      ok: false,
    });
  });

  it('fails closed on transport errors and malformed results', async () => {
    const transport = clientReturning(null, { message: 'fetch failed' });
    await expect(
      rpcMutateCart(transport as never, {
        cartId: CART_ID,
        command: { type: 'clear' },
        expectedVersion: 1,
        operationId: 'op-3',
      })
    ).rejects.toMatchObject({ code: 'temporarily_unavailable' });

    const malformed = clientReturning({ ok: 'yes' });
    await expect(
      rpcMutateCart(malformed as never, {
        cartId: CART_ID,
        command: { type: 'clear' },
        expectedVersion: 1,
        operationId: 'op-4',
      })
    ).rejects.toBeInstanceOf(CartRepositoryError);
  });
});

describe('rpcCreateCart', () => {
  it('creates through the creation RPC without trusting client prices', async () => {
    const client = clientReturning({
      code: null,
      ok: true,
      replayed: false,
      state: rawState(),
    });

    await rpcCreateCart(client as never, {
      currency: 'NGN',
      lines: [
        {
          item: {
            productId: '33333333-3333-4333-8333-333333333333',
          },
          quantity: 1,
        },
      ],
      operationId: 'create-1',
    });

    const [, params] = client.rpc.mock.calls[0] as [
      string,
      Record<string, unknown>,
    ];
    expect(client.rpc.mock.calls[0][0]).toBe('commerce_cart_create');
    expect(JSON.stringify(params)).not.toContain('price');
  });

  it('surfaces the server-minted grant id for session proof issuance', async () => {
    const grantId = '99999999-9999-4999-8999-999999999991';
    const client = clientReturning({
      code: null,
      grantId,
      ok: true,
      replayed: false,
      state: rawState(),
    });

    const result = await rpcCreateCart(client as never, {
      operationId: 'create-2',
    });

    expect(result.grantId).toBe(grantId);
  });

  it('drops malformed grant ids instead of trusting them', async () => {
    const client = clientReturning({
      code: null,
      grantId: 'not-a-grant',
      ok: true,
      replayed: false,
      state: rawState(),
    });

    const result = await rpcCreateCart(client as never, {
      operationId: 'create-3',
    });

    expect(result.grantId).toBeNull();
  });
});

describe('rpcGetCart', () => {
  it('reads the current raw state for one cart', async () => {
    const client = clientReturning({
      code: null,
      ok: true,
      replayed: false,
      state: rawState(),
    });

    const result = await rpcGetCart(client as never, CART_ID);

    expect(result.ok).toBe(true);
    expect(client.rpc).toHaveBeenCalledWith('commerce_cart_snapshot', {
      p_cart_id: CART_ID,
    });
  });
});
