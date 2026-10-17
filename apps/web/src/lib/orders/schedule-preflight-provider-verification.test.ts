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
    vi.mocked(checkCancellationRefundProvider).mockResolvedValue([]);
  });

  it('verifies with a listing deadline bounded by the preflight worst case', async () => {
    const start = 1_000_000_000_000;
    vi.spyOn(Date, 'now').mockReturnValue(start);
    try {
      await expect(
        schedulePreflightProviderVerification(
          input({ deadlineMs: start + 500_000 })
        )
      ).resolves.toEqual({ verified: true, pairedProviderRefunds: [] });
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

  // A 40s window admits manual-leg verification (the stamp
  // persists) but defers provider legs: without the initiation
  // reserve the run would verify and then refuse to initiate,
  // burning an attempt for zero in-memory progress.
  it('admits manual verification in a window shorter than verify-plus-initiation', async () => {
    const start = 1_000_000_000_000;
    vi.spyOn(Date, 'now').mockReturnValue(start);
    try {
      await expect(
        schedulePreflightProviderVerification(
          input({ deadlineMs: start + 40_000 })
        )
      ).resolves.toEqual({ verified: true, pairedProviderRefunds: [] });
    } finally {
      vi.restoreAllMocks();
    }
    expect(checkCancellationRefundProvider).toHaveBeenCalledTimes(1);
  });

  it('defers provider legs without room for verification plus initiation', async () => {
    const start = 1_000_000_000_000;
    vi.spyOn(Date, 'now').mockReturnValue(start);
    let error: unknown;
    try {
      error = await schedulePreflightProviderVerification(
        input({ deadlineMs: start + 40_000, reserveInitiation: true })
      ).catch((reason: unknown) => reason);
    } finally {
      vi.restoreAllMocks();
    }
    expect(error).toBeInstanceOf(DeferredError);
    expect(checkCancellationRefundProvider).not.toHaveBeenCalled();
    expect(tryResetCancellationSideEffectAttempts).toHaveBeenCalled();
  });

  it('admits provider legs with room for verification plus initiation', async () => {
    const start = 1_000_000_000_000;
    vi.spyOn(Date, 'now').mockReturnValue(start);
    try {
      await expect(
        schedulePreflightProviderVerification(
          input({ deadlineMs: start + 80_000, reserveInitiation: true })
        )
      ).resolves.toEqual({ verified: true, pairedProviderRefunds: [] });
    } finally {
      vi.restoreAllMocks();
    }
    expect(checkCancellationRefundProvider).toHaveBeenCalledTimes(1);
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

  it('passes paired provider refunds through on success', async () => {
    vi.mocked(checkCancellationRefundProvider).mockResolvedValue([
      { kobo: 100, providerRefundId: '7' },
      { kobo: 100, providerRefundId: '8' },
    ]);
    const result = await schedulePreflightProviderVerification(input({}));
    expect(result).toEqual({
      verified: true,
      pairedProviderRefunds: [
        { kobo: 100, providerRefundId: '7' },
        { kobo: 100, providerRefundId: '8' },
      ],
    });
  });

  it('shortfalls without throwing once a prefix is verified', async () => {
    const result = await schedulePreflightProviderVerification(
      input({
        deadlineMs: Date.now() + 10_000,
        hasVerifiedPrefix: true,
      })
    );
    expect(result).toEqual({ verified: false, pairedProviderRefunds: [] });
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
    expect(result).toEqual({ verified: false, pairedProviderRefunds: [] });
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
