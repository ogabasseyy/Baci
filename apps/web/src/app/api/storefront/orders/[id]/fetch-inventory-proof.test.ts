import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchOrderInventoryProof } from './fetch-inventory-proof';

describe('fetchOrderInventoryProof', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns true only on an explicit true bit', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: true, error: null });

    await expect(
      fetchOrderInventoryProof({ rpc } as never, 'order-1', 'tok-1')
    ).resolves.toBe(true);
    expect(rpc).toHaveBeenCalledWith('get_order_inventory_proof', {
      p_order_id: 'order-1',
      p_tracking_token: 'tok-1',
      p_email: null,
    });
  });

  it('forwards the order email for the email fallback lookup', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: true, error: null });

    await expect(
      fetchOrderInventoryProof({ rpc } as never, 'order-1', null, 'a@b.c')
    ).resolves.toBe(true);
    expect(rpc).toHaveBeenCalledWith('get_order_inventory_proof', {
      p_order_id: 'order-1',
      p_tracking_token: null,
      p_email: 'a@b.c',
    });
  });

  it('fails closed on false, missing, or errored lookups', async () => {
    for (const outcome of [
      { data: false, error: null },
      { data: null, error: null },
      { data: null, error: new Error('db down') },
    ]) {
      const rpc = vi.fn().mockResolvedValue(outcome);

      await expect(
        fetchOrderInventoryProof({ rpc } as never, 'order-1', 'tok-1')
      ).resolves.toBe(false);
    }
  });
});
