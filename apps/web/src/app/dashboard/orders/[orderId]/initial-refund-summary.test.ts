import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}));

import { createClient } from '@/lib/supabase/server';
import { getInitialRefundSummary } from './initial-refund-summary';

describe('getInitialRefundSummary', () => {
  beforeEach(() => vi.clearAllMocks());

  function mockRpc(resolved: unknown) {
    const rpc = vi.fn().mockResolvedValue(resolved);
    vi.mocked(createClient).mockResolvedValue({ rpc } as never);
    return rpc;
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
    const summary = await getInitialRefundSummary('order-1');
    expect(rpc).toHaveBeenCalledWith('manage_order_refund', {
      p_action: 'status',
      p_order_id: 'order-1',
    });
    expect(summary).toMatchObject({ currency: 'NGN', status: 'failed' });
    expect(summary).not.toHaveProperty('internal_debug');
  });

  it('returns null when the RPC errors so the panel loads client-side', async () => {
    mockRpc({ data: null, error: { message: 'boom' } });
    await expect(getInitialRefundSummary('order-1')).resolves.toBeNull();
  });

  it('returns null when the client throws', async () => {
    vi.mocked(createClient).mockRejectedValueOnce(new Error('no session'));
    await expect(getInitialRefundSummary('order-1')).resolves.toBeNull();
  });
});
