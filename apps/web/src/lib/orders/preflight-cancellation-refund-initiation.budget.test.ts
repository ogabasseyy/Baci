import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/orders/check-cancellation-refund-provider', () => ({
  checkCancellationRefundProvider: vi.fn().mockResolvedValue(undefined),
}));

import { checkCancellationRefundProvider } from '@/lib/orders/check-cancellation-refund-provider';
import { preflightCancellationRefundInitiation } from './preflight-cancellation-refund-initiation';
import {
  order as baseOrder,
  preflightInput,
} from './preflight-cancellation-refund-initiation.test-support';
import { DeferredError } from './run-order-cancellation-side-effect';

function fourPaystackLegs() {
  return [1, 2, 3, 4].map((n) => ({
    amount: 100,
    currency: 'NGN',
    gateway: 'paystack',
    gateway_reference: `ref-${n}`,
    id: `payment-${n}`,
  }));
}

describe('preflightCancellationRefundInitiation budget deferral', () => {
  beforeEach(() => vi.clearAllMocks());

  it('defers instead of burning a short budget on the provider guard', async () => {
    const update = vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnThis(),
    });
    const from = vi.fn().mockReturnValue({ update });
    const error = await preflightCancellationRefundInitiation(
      preflightInput({
        deadlineMs: Date.now() + 10_000,
        supabase: { from } as never,
      })
    ).catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(DeferredError);
    expect((error as Error).message).toBe(
      'cancellation_refund_preflight_deferred_for_budget'
    );
    expect(checkCancellationRefundProvider).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledWith({ attempts: 0 });
  });
  it('defers provider legs in a window that fits verification but not initiation', async () => {
    // 60s covers the 38s verification admission but not the 76s
    // verify-plus-initiate admission: provider verification
    // persists nothing, so verifying now would burn an attempt and
    // then refuse to initiate. Defer free instead.
    const update = vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnThis(),
    });
    const from = vi.fn().mockReturnValue({ update });
    const error = await preflightCancellationRefundInitiation(
      preflightInput({
        deadlineMs: Date.now() + 60_000,
        supabase: { from } as never,
      })
    ).catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(DeferredError);
    expect(checkCancellationRefundProvider).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledWith({ attempts: 0 });
  });
  it('verifies provider legs in a window that fits verification plus initiation', async () => {
    const result = await preflightCancellationRefundInitiation(
      preflightInput({
        deadlineMs: Date.now() + 80_000,
      })
    );
    expect(checkCancellationRefundProvider).toHaveBeenCalledTimes(1);
    expect(result.budgetDeferred).toBe(false);
    expect(result.initiationTransactions.map((leg) => leg.id)).toEqual([
      'payment-1',
    ]);
  });
  it('caps the provider guard listing by the preflight worst case', async () => {
    const before = Date.now();
    await preflightCancellationRefundInitiation(
      preflightInput({ deadlineMs: before + 120_000 })
    );
    const forwarded = vi.mocked(checkCancellationRefundProvider).mock
      .calls[0][0].deadlineMs as number;
    expect(forwarded).toBeGreaterThan(before + 29_000);
    expect(forwarded).toBeLessThanOrEqual(Date.now() + 30_000);
  });
  it('resets attempts when the provider guard defers on budget', async () => {
    const update = vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnThis(),
    });
    const from = vi.fn().mockReturnValue({ update });
    vi.mocked(checkCancellationRefundProvider).mockRejectedValueOnce(
      new DeferredError('cancellation_refund_provider_verification_deferred')
    );
    const error = await preflightCancellationRefundInitiation(
      preflightInput({
        deadlineMs: Date.now() + 120_000,
        supabase: { from } as never,
      })
    ).catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(DeferredError);
    expect(update).toHaveBeenCalledWith({ attempts: 0 });
  });
  it('verifies every leg when the window fits them all', async () => {
    const result = await preflightCancellationRefundInitiation(
      preflightInput({
        deadlineMs: Date.now() + 500_000,
        order: { ...baseOrder, amount_paid: 400 } as never,
        transactions: fourPaystackLegs() as never,
      })
    );
    expect(result.budgetDeferred).toBe(false);
    expect(result.initiationTransactions.map((leg) => leg.id)).toEqual([
      'payment-1',
      'payment-2',
      'payment-3',
      'payment-4',
    ]);
    expect(checkCancellationRefundProvider).toHaveBeenCalledTimes(4);
  });
  it('names skipped manual legs so settle defers instead of quarantining them', async () => {
    // A slow ordinary verification consumes the window before the
    // manual claim verifies: the skipped leg must resume next run,
    // never quarantine as mismatched this run. 60s consumed of a
    // 90s window leaves 30s, under the 38s manual verification
    // admission (the provider leg admitted at 90s >= 76s).
    const start = 1_000_000_000_000;
    let nowCalls = 0;
    const nowSpy = vi.spyOn(Date, 'now').mockImplementation(() => {
      nowCalls += 1;
      return nowCalls <= 2 ? start : start + 60_000;
    });
    try {
      const result = await preflightCancellationRefundInitiation(
        preflightInput({
          deadlineMs: start + 90_000,
          manualLinkedLegIds: new Set(['payment-2']),
          mismatchedIds: new Set(['payment-2']),
          refundRows: [
            {
              amount: 100,
              currency: 'NGN',
              gateway: 'manual',
              id: 'refund-2',
              metadata: {
                method: 'paystack',
                payment_transaction_id: 'payment-2',
              },
              status: 'completed',
            },
          ],
          transactions: [
            ...(fourPaystackLegs().slice(0, 1) as never[]),
            {
              amount: 100,
              currency: 'NGN',
              gateway: 'paystack',
              gateway_reference: 'ref-2',
              id: 'payment-2',
            } as never,
          ],
        })
      );
      expect(result.budgetDeferred).toBe(true);
      expect(result.budgetSkippedManualLegIds).toEqual(['payment-2']);
      expect(result.verifiedManualPaystackLegIds).toEqual([]);
      expect(result.initiationTransactions.map((leg) => leg.id)).toEqual([
        'payment-1',
      ]);
      expect(checkCancellationRefundProvider).toHaveBeenCalledTimes(1);
    } finally {
      nowSpy.mockRestore();
    }
  });
  it('keeps the verified prefix when a later check defers', async () => {
    // A deferred provider listing must not discard the already
    // verified leg: settle initiates the prefix and resumes the
    // rest instead of repeating the same checks every drain.
    vi.mocked(checkCancellationRefundProvider)
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(
        new DeferredError('cancellation_refund_provider_verification_deferred')
      );
    const result = await preflightCancellationRefundInitiation(
      preflightInput({
        deadlineMs: Date.now() + 500_000,
        order: { ...baseOrder, amount_paid: 400 } as never,
        transactions: fourPaystackLegs() as never,
      })
    );
    expect(result.budgetDeferred).toBe(true);
    expect(result.initiationTransactions.map((leg) => leg.id)).toEqual([
      'payment-1',
    ]);
    expect(checkCancellationRefundProvider).toHaveBeenCalledTimes(2);
  });
  it('returns the verified prefix when the window runs short mid-run', async () => {
    // Four legs under a 90s workflow window: the first
    // verification fits (90s clears the 76s provider admission),
    // the second does not (60s consumed leaves 30s). The run must
    // initiate its verified prefix and resume the rest — never
    // discard verified work by deferring before doing anything on
    // every invocation.
    const start = 1_000_000_000_000;
    let nowCalls = 0;
    const nowSpy = vi.spyOn(Date, 'now').mockImplementation(() => {
      nowCalls += 1;
      return nowCalls <= 2 ? start : start + 60_000;
    });
    try {
      const result = await preflightCancellationRefundInitiation(
        preflightInput({
          deadlineMs: start + 90_000,
          order: { ...baseOrder, amount_paid: 400 } as never,
          transactions: fourPaystackLegs() as never,
        })
      );
      expect(result.budgetDeferred).toBe(true);
      expect(result.initiationTransactions.map((leg) => leg.id)).toEqual([
        'payment-1',
      ]);
      expect(checkCancellationRefundProvider).toHaveBeenCalledTimes(1);
    } finally {
      nowSpy.mockRestore();
    }
  });
});
