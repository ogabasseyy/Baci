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
  it('defers when the window fits verification but not initiation', async () => {
    const update = vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnThis(),
    });
    const from = vi.fn().mockReturnValue({ update });
    // 60s covers the 30s verification alone, but initiation needs its
    // own 38s leg after it: starting verification would burn the
    // attempt when initiation deadline-exceeds with no refund sent.
    const error = await preflightCancellationRefundInitiation(
      preflightInput({
        deadlineMs: Date.now() + 60_000,
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
  it('returns the verified prefix when the window runs short mid-run', async () => {
    // Four legs under a 90s workflow window: the first verification
    // fits, the second does not. The run must initiate its verified
    // prefix and resume the rest — never discard verified work by
    // deferring before doing anything on every invocation.
    const start = 1_000_000_000_000;
    let nowCalls = 0;
    const nowSpy = vi.spyOn(Date, 'now').mockImplementation(() => {
      nowCalls += 1;
      return nowCalls <= 2 ? start : start + 40_000;
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
