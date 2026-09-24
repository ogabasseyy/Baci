import { describe, expect, it, vi } from 'vitest';
import { fetchAuthenticatedDeliveryFlag } from './fetch-authenticated-delivery-flag';

function clientFor(rpc: ReturnType<typeof vi.fn>) {
  return { rpc };
}

describe('fetchAuthenticatedDeliveryFlag', () => {
  it('returns true when the delivery RPC confirms sent', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: true, error: null });

    await expect(
      fetchAuthenticatedDeliveryFlag(clientFor(rpc), 'order-1')
    ).resolves.toBe(true);
    expect(rpc).toHaveBeenCalledWith('get_order_notification_delivered', {
      p_order_id: 'order-1',
    });
  });

  it('returns false when the RPC reports not delivered', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: false, error: null });

    await expect(
      fetchAuthenticatedDeliveryFlag(clientFor(rpc), 'order-1')
    ).resolves.toBe(false);
  });

  it('reads failures as not delivered', async () => {
    const rpc = vi
      .fn()
      .mockResolvedValue({ data: null, error: { message: 'boom' } });

    await expect(
      fetchAuthenticatedDeliveryFlag(clientFor(rpc), 'order-1')
    ).resolves.toBe(false);
  });
});
