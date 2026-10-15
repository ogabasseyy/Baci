import { beforeEach, describe, expect, it, vi } from 'vitest';
import { checkCancellationRefundProvider } from '@/lib/orders/check-cancellation-refund-provider';
import { tryResetCancellationSideEffectAttempts } from '@/lib/orders/reset-cancellation-side-effect-attempts';
import { DeferredError } from '@/lib/orders/run-order-cancellation-side-effect';
import {
  linkedPaymentId,
  order,
  paystackPayment,
  preflightSupabase,
} from './preflight-cancellation-refund-initiation.test-support';
import { schedulePreflightProviderVerification } from './schedule-preflight-provider-verification';

vi.mock('@/lib/orders/check-cancellation-refund-provider', () => ({
  checkCancellationRefundProvider: vi.fn(),
}));
vi.mock('@/lib/orders/reset-cancellation-side-effect-attempts', () => ({
  tryResetCancellationSideEffectAttempts: vi.fn(),
}));

function input(overrides: Record<string, unknown> = {}) {
  return {
    deadlineMs: undefined,
    hasVerifiedPrefix: false,
    linkedPaymentId,
    order: order as never,
    refundRows: [],
    supabase: preflightSupabase() as never,
    transaction: paystackPayment as never,
    ...overrides,
  };
}

describe('schedulePreflightProviderVerification', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(checkCancellationRefundProvider).mockResolvedValue(undefined);
  });

  it('verifies with a listing deadline bounded by the preflight worst case', async () => {
    const start = 1_000_000_000_000;
    vi.spyOn(Date, 'now').mockReturnValue(start);
    try {
      await expect(
        schedulePreflightProviderVerification(
          input({ deadlineMs: start + 500_000 })
        )
      ).resolves.toBe(true);
    } finally {
      vi.restoreAllMocks();
    }
    expect(checkCancellationRefundProvider).toHaveBeenCalledWith(
      expect.objectContaining({
        deadlineMs: start + 30_000,
        reference: 'ref-1',
      })
    );
  });

  it('filters known refunds to the verified leg', async () => {
    const own = {
      amount: 100,
      id: 'refund-1',
      metadata: { payment_transaction_id: 'payment-1' },
      status: 'completed',
    };
    const other = {
      amount: 100,
      id: 'refund-9',
      metadata: { payment_transaction_id: 'payment-9' },
      status: 'completed',
    };
    await schedulePreflightProviderVerification(
      input({ refundRows: [own, other] })
    );
    expect(checkCancellationRefundProvider).toHaveBeenCalledWith(
      expect.objectContaining({ knownRefunds: [own] })
    );
  });

  it('shortfalls without throwing once a prefix is verified', async () => {
    const result = await schedulePreflightProviderVerification(
      input({
        deadlineMs: Date.now() + 10_000,
        hasVerifiedPrefix: true,
      })
    );
    expect(result).toBe(false);
    expect(checkCancellationRefundProvider).not.toHaveBeenCalled();
    expect(tryResetCancellationSideEffectAttempts).not.toHaveBeenCalled();
  });

  it('resets and throws when no verification fits at all', async () => {
    const error = await schedulePreflightProviderVerification(
      input({ deadlineMs: Date.now() + 10_000 })
    ).catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(DeferredError);
    expect(checkCancellationRefundProvider).not.toHaveBeenCalled();
    expect(tryResetCancellationSideEffectAttempts).toHaveBeenCalledWith(
      expect.anything(),
      'order-1',
      'refund'
    );
  });

  it('converts a deferred check after a prefix into a shortfall', async () => {
    vi.mocked(checkCancellationRefundProvider).mockRejectedValueOnce(
      new DeferredError('cancellation_refund_provider_verification_deferred')
    );
    const result = await schedulePreflightProviderVerification(
      input({ hasVerifiedPrefix: true })
    );
    // Settle initiates the verified prefix and resets on its own
    // deferred resume; no throw, no double reset here.
    expect(result).toBe(false);
    expect(tryResetCancellationSideEffectAttempts).not.toHaveBeenCalled();
  });

  it('resets and rethrows a deferred check with no prefix', async () => {
    vi.mocked(checkCancellationRefundProvider).mockRejectedValueOnce(
      new DeferredError('cancellation_refund_provider_verification_deferred')
    );
    const error = await schedulePreflightProviderVerification(input()).catch(
      (reason: unknown) => reason
    );
    expect(error).toBeInstanceOf(DeferredError);
    expect(tryResetCancellationSideEffectAttempts).toHaveBeenCalled();
  });

  it('rethrows non-deferral check failures without resetting', async () => {
    vi.mocked(checkCancellationRefundProvider).mockRejectedValueOnce(
      new Error('provider down')
    );
    await expect(
      schedulePreflightProviderVerification(input())
    ).rejects.toThrow('provider down');
    expect(tryResetCancellationSideEffectAttempts).not.toHaveBeenCalled();
  });
});
