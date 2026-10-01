import { expect, it, vi } from 'vitest';
import { reconcileAbandonedPaystackAttempts } from './reconcile-abandoned-paystack-attempts';

it('stops starting attempts at the pass deadline', async () => {
  const candidates = {
    eq: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    is: vi.fn().mockReturnThis(),
    neq: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue({
      data: [
        {
          amount: 100,
          currency: 'NGN',
          gateway_reference: 'BAC-1',
          id: 'attempt-1',
          merchant_id: 'merchant-1',
          metadata: {},
          order_id: 'order-1',
          status: 'pending',
        },
      ],
      error: null,
    }),
    not: vi.fn().mockReturnThis(),
    or: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
  };
  const from = vi.fn().mockReturnValue(candidates);
  const verify = vi.fn();
  const now = vi.spyOn(Date, 'now').mockReturnValue(1_090_000);

  try {
    const summary = await reconcileAbandonedPaystackAttempts({
      deadlineMs: 1_090_000,
      supabase: { from } as never,
      verify: verify as never,
    });

    expect(summary.checked).toBe(0);
    expect(summary.failed).toBe(false);
    expect(verify).not.toHaveBeenCalled();
  } finally {
    now.mockRestore();
  }
});
