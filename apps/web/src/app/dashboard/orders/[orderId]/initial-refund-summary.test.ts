import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}));

import { createClient } from '@/lib/supabase/server';
import { getInitialRefundSummary } from './initial-refund-summary';

describe('getInitialRefundSummary', () => {
  beforeEach(() => vi.clearAllMocks());

  function mockRpc(resolved: unknown, mode: string | null = 'manual') {
    const rpc = vi.fn().mockResolvedValue(resolved);
    const eqMerchant = vi.fn(() => ({
      maybeSingle: vi.fn().mockResolvedValue({
        data: { cancellation_refund_mode: mode },
        error: null,
      }),
    }));
    const eqId = vi.fn(() => ({ eq: eqMerchant }));
    const from = vi.fn(() => ({ select: vi.fn(() => ({ eq: eqId })) }));
    vi.mocked(createClient).mockResolvedValue({ from, rpc } as never);
    return Object.assign(rpc, { eqId, eqMerchant });
  }

  it('returns the masked status summary', async () => {
    const rpc = mockRpc({
      data: {
        currency: 'NGN',
        error: null,
        internal_debug: 'drop me',
        status: 'failed',
      },
      error: null,
    });
    const summary = await getInitialRefundSummary('order-1', 'merchant-1');
    expect(rpc).toHaveBeenCalledWith('manage_order_refund', {
      p_action: 'status',
      p_order_id: 'order-1',
    });
    expect(rpc.eqId).toHaveBeenCalledWith('id', 'order-1');
    expect(rpc.eqMerchant).toHaveBeenCalledWith('merchant_id', 'merchant-1');
    expect(summary).toMatchObject({
      cancellationRefundMode: 'manual',
      currency: 'NGN',
      status: 'failed',
    });
    expect(summary).not.toHaveProperty('internal_debug');
  });

  it('returns null when the RPC errors so the panel loads client-side', async () => {
    mockRpc({ data: null, error: { message: 'boom' } });
    await expect(
      getInitialRefundSummary('order-1', 'merchant-1')
    ).resolves.toBeNull();
  });

  it('returns null when the client throws', async () => {
    vi.mocked(createClient).mockRejectedValueOnce(new Error('no session'));
    await expect(
      getInitialRefundSummary('order-1', 'merchant-1')
    ).resolves.toBeNull();
  });
});
