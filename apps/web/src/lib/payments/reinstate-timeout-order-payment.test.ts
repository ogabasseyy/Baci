import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import { reinstateTimeoutOrderPayment } from './reinstate-timeout-order-payment';

const refresh = vi.hoisted(() => vi.fn());
vi.mock('./ensure-paid-order-inventory-confirmed', () => ({
  refreshReclaimedOrderInventory: refresh,
}));

function mockClient(data: unknown, error: { message: string } | null = null) {
  const rpc = vi.fn().mockResolvedValue({ data, error });
  const orderQuery = {
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({
      data: { id: 'order' },
      error: null,
    }),
    select: vi.fn().mockReturnThis(),
  };
  const client = {
    from: vi.fn().mockReturnValue(orderQuery),
    rpc,
  } as unknown as SupabaseClient;
  return { client, orderQuery, rpc };
}

describe('reinstateTimeoutOrderPayment', () => {
  it.each([
    'blocked',
    'reinstated',
    'already_reinstated',
  ] as const)('preserves %s without refreshing stock', async (state) => {
    refresh.mockClear();
    const { client, rpc } = mockClient(state);
    await expect(
      reinstateTimeoutOrderPayment(client, 'order', 'transaction', 'merchant')
    ).resolves.toBe(state);
    expect(rpc).toHaveBeenCalledExactlyOnceWith(
      'reinstate_timeout_order_payment',
      { p_order_id: 'order', p_transaction_id: 'transaction' }
    );
    expect(refresh).not.toHaveBeenCalled();
  });

  it('does not call the privileged RPC when the order is outside the merchant scope', async () => {
    const { client, orderQuery, rpc } = mockClient('reinstated');
    orderQuery.maybeSingle.mockResolvedValue({ data: null, error: null });
    await expect(
      reinstateTimeoutOrderPayment(
        client,
        'order',
        'transaction',
        'other-merchant'
      )
    ).resolves.toBe('blocked');
    expect(orderQuery.eq).toHaveBeenCalledWith('merchant_id', 'other-merchant');
    expect(rpc).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });

  it('refreshes caches for a reclaimed unit', async () => {
    refresh.mockClear();
    const { client } = mockClient('reinstated_inventory_reclaimed');
    await expect(
      reinstateTimeoutOrderPayment(client, 'order', 'transaction', 'merchant')
    ).resolves.toBe('reinstated');
    expect(refresh).toHaveBeenCalledExactlyOnceWith(
      client,
      'merchant',
      'order'
    );
  });

  it('rejects an invalid RPC result', async () => {
    const { client } = mockClient(null);
    await expect(
      reinstateTimeoutOrderPayment(client, 'order', 'transaction', 'merchant')
    ).rejects.toThrow('invalid result');
  });

  it('propagates an RPC failure for retry', async () => {
    const { client } = mockClient(null, { message: 'Unavailable' });
    await expect(
      reinstateTimeoutOrderPayment(client, 'order', 'transaction', 'merchant')
    ).rejects.toThrow('Late payment reinstatement failed');
  });
});
