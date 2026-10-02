import { expect, it, vi } from 'vitest';
import { reconcileAbandonedPaystackAttempts } from './reconcile-abandoned-paystack-attempts';

it('stops starting attempts at the pass deadline', async () => {
  const rpc = vi.fn().mockResolvedValue({
    data: [
      {
        amount: 100,
        currency: 'NGN',
        gateway: 'paystack',
        gateway_reference: 'BAC-1',
        id: 'attempt-1',
        merchant_id: 'merchant-1',
        metadata: {},
        order_id: 'order-1',
        status: 'pending',
      },
    ],
    error: null,
  });
  const from = vi.fn();
  const verify = vi.fn();
  const now = vi.spyOn(Date, 'now').mockReturnValue(1_090_000);

  try {
    const summary = await reconcileAbandonedPaystackAttempts({
      deadlineMs: 1_090_000,
      supabase: { from, rpc } as never,
      verify: verify as never,
    });

    expect(summary.checked).toBe(0);
    expect(summary.failed).toBe(false);
    expect(verify).not.toHaveBeenCalled();
  } finally {
    now.mockRestore();
  }
});
