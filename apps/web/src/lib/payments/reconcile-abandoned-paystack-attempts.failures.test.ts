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
    const { client, selectUpdated, update } = createClient();
    if (failure === 'error') {
      selectUpdated.mockResolvedValue({
        data: null,
        error: new Error('database unavailable'),
      });
    } else {
      selectUpdated.mockRejectedValue(new Error('database unavailable'));
    }

    const summary = await reconcileAbandonedPaystackAttempts({
      supabase: client as never,
      verify: vi.fn().mockResolvedValue(abandoned),
    });
    expect(summary.failed).toBe(true);
    expect(summary.held).toEqual([
      { id: 'attempt-1', reason: 'retirement_failed' },
    ]);
    expect(summary.retired).toEqual([]);
    expect(update).toHaveBeenCalledWith({ updated_at: expect.any(String) });
  });

  it.each([
    'error',
    'rejection',
  ] as const)('fails the sweep when a held-attempt rotation returns %s', async (failure) => {
    const { client, updateBuilder } = createClient();
    if (failure === 'error') {
      Object.assign(updateBuilder, {
        // biome-ignore lint/suspicious/noThenProperty: Supabase query builders are awaited thenables.
        then: (resolve: (result: { error: Error }) => void) =>
          resolve({ error: new Error('rotation unavailable') }),
      });
    } else {
      Object.assign(updateBuilder, {
        // biome-ignore lint/suspicious/noThenProperty: Supabase query builders are awaited thenables.
        then: (
          _resolve: (result: { error: null }) => void,
          reject: (reason: unknown) => void
        ) => reject(new Error('rotation unavailable')),
      });
    }

    const summary = await reconcileAbandonedPaystackAttempts({
      supabase: client as never,
      verify: vi.fn().mockRejectedValue(new Error('provider down')),
    });
    expect(summary.failed).toBe(true);
    expect(summary.held).toEqual([
      {
        id: 'attempt-1',
        reason: 'verification_unavailable',
        rotationFailed: true,
      },
    ]);
    expect(summary.retired).toEqual([]);
  });

  it.each([
    ['order', 'order_not_paid_or_unavailable'],
    ['completed payment', 'no_completed_payment_or_unavailable'],
  ])('fails the sweep when the %s lookup errors', async (_label, reason) => {
    const { client, orderLookup, completedLookup } = createClient();
    if (reason === 'order_not_paid_or_unavailable') {
      orderLookup.maybeSingle.mockResolvedValue({
        data: null,
        error: { message: 'database unavailable' },
      });
    } else {
      completedLookup.limit.mockResolvedValue({
        data: null,
        error: { message: 'database unavailable' },
      });
    }
    const verify = vi.fn();

    const summary = await reconcileAbandonedPaystackAttempts({
      supabase: client as never,
      verify,
    });

    expect(summary.failed).toBe(true);
    expect(summary.held).toEqual([{ id: 'attempt-1', reason }]);
    expect(verify).not.toHaveBeenCalled();
  });

  it.each([
    'NETWORK_ERROR',
    'CONFIG_ERROR',
    'HTTP_401',
    'HTTP_403',
    'HTTP_429',
    'HTTP_500',
    'HTTP_503',
  ])('fails the sweep when verification is unavailable (%s)', async (code) => {
    const { client } = createClient();

    const summary = await reconcileAbandonedPaystackAttempts({
      supabase: client as never,
      verify: vi.fn().mockResolvedValue({ success: false, code }),
    });

    expect(summary.failed).toBe(true);
    expect(summary.held).toEqual([
      { id: 'attempt-1', reason: 'verification_unavailable' },
    ]);
    expect(summary.retired).toEqual([]);
  });

  it.each([
    'HTTP_404',
    'HTTP_400',
  ])('holds without failing on a genuine provider verdict (%s)', async (code) => {
    const { client } = createClient();

    const summary = await reconcileAbandonedPaystackAttempts({
      supabase: client as never,
      verify: vi.fn().mockResolvedValue({ success: false, code }),
    });

    expect(summary.failed).toBe(false);
    expect(summary.held).toEqual([
      { id: 'attempt-1', reason: 'verification_unavailable' },
    ]);
  });

  it('fails the sweep when verification throws', async () => {
    const { client } = createClient();

    const summary = await reconcileAbandonedPaystackAttempts({
      supabase: client as never,
      verify: vi.fn().mockRejectedValue(new Error('provider down')),
    });

    expect(summary.failed).toBe(true);
    expect(summary.held).toEqual([
      { id: 'attempt-1', reason: 'verification_unavailable' },
    ]);
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
