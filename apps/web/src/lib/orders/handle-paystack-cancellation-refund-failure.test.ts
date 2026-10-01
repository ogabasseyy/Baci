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
