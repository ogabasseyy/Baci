import type { SupabaseClient } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { handlePaystackCancellationRefundFailure } from './handle-paystack-cancellation-refund-failure';
import {
  initiationOrder,
  initiationTransaction,
} from './initiate-paystack-cancellation-refunds.test-helpers';
import { DeliveryUncertainError } from './run-order-cancellation-side-effect';

const mocks = vi.hoisted(() => ({
  quarantineRefund: vi.fn(),
}));

vi.mock('./quarantine-order-cancellation-refund', () => ({
  quarantineRefund: mocks.quarantineRefund,
}));

describe('handlePaystackCancellationRefundFailure', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.quarantineRefund.mockResolvedValue(undefined as never);
  });

  function invoke(
    overrides: {
      code?: string;
      error?: string;
      isLastAttempt?: boolean;
      refundIds?: number[];
    } = {}
  ) {
    return handlePaystackCancellationRefundFailure({
      isLastAttempt: overrides.isLastAttempt,
      order: initiationOrder,
      paystackRefund: {
        code: overrides.code ?? 'VALIDATION_ERROR',
        error: overrides.error ?? 'rejected',
        success: false,
      },
      refundIds: overrides.refundIds ?? [],
      supabase: {} as unknown as Pick<SupabaseClient, 'from' | 'rpc'>,
      transaction: initiationTransaction,
    });
  }

  it('quarantines a deterministic rejection for operations and throws retryable', async () => {
    await expect(invoke()).rejects.toThrow('rejected');

    expect(mocks.quarantineRefund).toHaveBeenCalledTimes(1);
    expect(mocks.quarantineRefund).toHaveBeenCalledWith(
      expect.objectContaining({
        preflight: true,
        reason: expect.stringContaining('rejected'),
      })
    );
  });

  it('quarantines an ambiguous failure terminally and throws delivery-uncertain', async () => {
    await expect(
      invoke({ code: 'NETWORK_ERROR', error: 'socket hung up' })
    ).rejects.toThrow(DeliveryUncertainError);

    expect(mocks.quarantineRefund).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({ ambiguous_initiation: true }),
        preflight: false,
      })
    );
  });

  it('keeps a definite transient failure review-free while retries remain', async () => {
    await expect(
      invoke({ code: 'HTTP_429', error: 'slow down' })
    ).rejects.toThrow('slow down');

    expect(mocks.quarantineRefund).not.toHaveBeenCalled();
  });

  it('files expiring evidence for an exhausted rate-limited leg', async () => {
    await expect(
      invoke({ code: 'HTTP_429', error: 'slow down', isLastAttempt: true })
    ).rejects.toThrow('slow down');

    expect(mocks.quarantineRefund).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          ambiguous_initiation: false,
          rate_limit_exhausted: true,
        }),
        preflight: true,
      })
    );
  });

  it('marks an exhausted unconfigured leg distinctly from rate limiting', async () => {
    await expect(
      invoke({ code: 'CONFIG_ERROR', error: 'no secret', isLastAttempt: true })
    ).rejects.toThrow('no secret');

    expect(mocks.quarantineRefund).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({ config_exhausted: true }),
      })
    );
  });

  it.each([
    'HTTP_401',
    'HTTP_403',
  ])('retries a %s leg while attempts remain instead of terminalizing', async (code) => {
    // A rejected credential accepted nothing, so terminal quarantine
    // would strand the customer unrefunded behind delivery_uncertain
    // even after the key is corrected.
    await expect(invoke({ code, error: 'invalid key' })).rejects.toThrow(
      'invalid key'
    );

    expect(mocks.quarantineRefund).not.toHaveBeenCalled();
  });

  it('files auth exhaustion distinctly when credential retries run out', async () => {
    await expect(
      invoke({ code: 'HTTP_401', error: 'invalid key', isLastAttempt: true })
    ).rejects.toThrow('invalid key');

    expect(mocks.quarantineRefund).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          ambiguous_initiation: false,
          auth_exhausted: true,
        }),
        reason: expect.stringContaining('credentials were invalid'),
      })
    );
  });

  it('defers with a budget reset when a transient failure follows same-run progress', async () => {
    const eq = vi.fn().mockReturnThis();
    const update = vi.fn().mockReturnValue({ eq });
    const supabase = {
      from: vi.fn().mockReturnValue({ update }),
    } as unknown as Pick<SupabaseClient, 'from' | 'rpc'>;

    // The earlier legs consumed the order-level budget: this leg may
    // never have been attempted, so exhaustion evidence would
    // terminalize an untouched leg. Defer uncapped with a fresh budget.
    await expect(
      handlePaystackCancellationRefundFailure({
        isLastAttempt: true,
        order: initiationOrder,
        paystackRefund: {
          code: 'HTTP_429',
          error: 'slow down',
          success: false,
        },
        refundIds: [101],
        supabase,
        transaction: initiationTransaction,
      })
    ).rejects.toThrow('cancellation_refund_progress_deferred_for_settlement');

    expect(mocks.quarantineRefund).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledWith({ attempts: 0 });
    expect(eq).toHaveBeenCalledWith('order_id', 'order-1');
    expect(eq).toHaveBeenCalledWith('step', 'refund');
  });

  it('files exhaustion when the progress reset fails instead of deferring blind', async () => {
    const terminalEq = vi
      .fn()
      .mockResolvedValue({ data: null, error: { code: 'CONN' } });
    const eq = vi.fn().mockReturnValue({ eq: terminalEq });
    const update = vi.fn().mockReturnValue({ eq });
    const supabase = {
      from: vi.fn().mockReturnValue({ update }),
    } as unknown as Pick<SupabaseClient, 'from' | 'rpc'>;

    // The reset did not land, so the resumed leg would still be capped:
    // deferring would strand it with no evidence. File exhaustion with
    // the accepted legs attached instead.
    await expect(
      handlePaystackCancellationRefundFailure({
        isLastAttempt: true,
        order: initiationOrder,
        paystackRefund: {
          code: 'HTTP_429',
          error: 'slow down',
          success: false,
        },
        refundIds: [101],
        supabase,
        transaction: initiationTransaction,
      })
    ).rejects.toThrow('slow down');

    expect(mocks.quarantineRefund).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          accepted_refund_ids: [101],
          rate_limit_exhausted: true,
        }),
      })
    );
  });

  it('carries accepted legs into a later-leg failure review', async () => {
    await expect(
      invoke({ code: 'VALIDATION_ERROR', error: 'bad leg', refundIds: [101] })
    ).rejects.toThrow('bad leg');

    expect(mocks.quarantineRefund).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({ accepted_refund_ids: [101] }),
      })
    );
  });
});
