import { describe, expect, it, vi } from 'vitest';
import { reconcileAbandonedPaystackAttempts } from './reconcile-abandoned-paystack-attempts';
import { createClient } from './reconcile-abandoned-paystack-attempts.test-support';

const abandoned = {
  success: true,
  data: {
    reference: 'BAC-OLD',
    status: 'abandoned',
    amount: 10000,
    currency: 'NGN',
  },
};

describe('abandoned Paystack attempt operational failures', () => {
  it.each([
    'error',
    'rejection',
  ] as const)('fails the sweep when a verified retirement write returns %s', async (failure) => {
    const { client, selectUpdated } = createClient();
    if (failure === 'error') {
      selectUpdated.mockResolvedValue({
        data: null,
        error: new Error('database unavailable'),
      });
    } else {
      selectUpdated.mockRejectedValue(new Error('database unavailable'));
    }

    await expect(
      reconcileAbandonedPaystackAttempts({
        supabase: client as never,
        verify: vi.fn().mockResolvedValue(abandoned),
      })
    ).rejects.toThrow('abandoned_paystack_attempt_retirement_failed');
  });

  it('holds a verification request that hangs until its five-second deadline', async () => {
    const { client, update } = createClient();
    const verify = vi.fn(
      (_reference: string, signal: AbortSignal) =>
        new Promise<never>((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason), {
            once: true,
          });
        })
    );

    const summary = await reconcileAbandonedPaystackAttempts({
      supabase: client as never,
      verify: verify as never,
    });

    expect(verify).toHaveBeenCalledWith('BAC-OLD', expect.any(AbortSignal));
    expect(summary.held).toEqual([
      { id: 'attempt-1', reason: 'verification_unavailable' },
    ]);
    expect(update).not.toHaveBeenCalledWith(
      expect.objectContaining({ status: 'failed' })
    );
  }, 7_000);
});
