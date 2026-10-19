import { describe, expect, it, vi } from 'vitest';
import { loadCheckoutReplaySnapshot } from './has-existing-checkout-order';

// The loader must use the route's injected authority, never mint its own.
vi.mock('./storefront-order-rpc-client', () => ({
  createStorefrontOrderRpcClient: () => {
    throw new Error('Replay loader must not create credential authority');
  },
}));

describe('loadCheckoutReplaySnapshot', () => {
  it('returns the committed order condition prices from the scoped RPC', async () => {
    const rpc = vi.fn(async () => ({
      data: {
        order_id: 'order-1',
        items: [
          {
            product_id: 'p1',
            variant_id: null,
            condition: 'used',
            price: 60,
          },
          {
            product_id: 'p2',
            variant_id: 'v1',
            condition: 'used',
            price: 10,
          },
        ],
      },
      error: null,
    }));
    const snapshot = await loadCheckoutReplaySnapshot({
      client: { rpc } as never,
      merchantId: 'm1',
      requestIdempotencyKey: 'key-1',
    });
    expect(rpc).toHaveBeenCalledWith('storefront_checkout_replay_snapshot', {
      p_checkout_idempotency_key: 'key-1',
      p_merchant_id: 'm1',
    });
    expect(snapshot?.orderId).toBe('order-1');
    expect(snapshot?.conditionPriceOverrides.get('["p1","used"]')).toBe(60);
    expect(snapshot?.conditionPriceOverrides.size).toBe(1);
  });

  it('reports null when no order exists or the probe fails', async () => {
    await expect(
      loadCheckoutReplaySnapshot({
        client: {
          rpc: vi.fn(async () => ({ data: null, error: null })),
        } as never,
        merchantId: 'm1',
        requestIdempotencyKey: 'key-1',
      })
    ).resolves.toBeNull();
    await expect(
      loadCheckoutReplaySnapshot({
        client: {
          rpc: vi.fn(async () => ({
            data: null,
            error: { message: 'db down' },
          })),
        } as never,
        merchantId: 'm1',
        requestIdempotencyKey: 'key-1',
      })
    ).resolves.toBeNull();
  });
});
