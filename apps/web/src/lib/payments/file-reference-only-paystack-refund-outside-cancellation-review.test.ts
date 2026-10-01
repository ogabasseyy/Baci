import type { SupabaseClient } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fileReferenceOnlyPaystackRefundOutsideCancellationReview } from './file-reference-only-paystack-refund-outside-cancellation-review';

const mocks = vi.hoisted(() => ({ loggerWarn: vi.fn() }));

vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: mocks.loggerWarn },
}));

function input(overrides = {}) {
  return {
    amount: 100,
    currency: 'NGN',
    merchantId: 'merchant-1',
    orderId: 'order-1',
    orderNumber: 'ORD-1',
    paymentId: 'pay-1',
    paymentReference: 'PSK-1',
    providerRefundStatus: 'failed',
    ...overrides,
  };
}

// Thenable builder covering every chain in the settled-coverage helper
// (eq/gt/not/is) plus the review insert path.
function selectQuery(data: unknown, error: unknown = null) {
  return {
    eq: vi.fn().mockReturnThis(),
    gt: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    is: vi.fn().mockReturnThis(),
    not: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    // biome-ignore lint/suspicious/noThenProperty: Supabase query builders are thenable.
    then: (resolve: (value: unknown) => void) => resolve({ data, error }),
  };
}

function uncoveredQueries() {
  // No linked refunds, no external payments: the event is not covered.
  return [selectQuery([]), selectQuery([])];
}

describe('fileReferenceOnlyPaystackRefundOutsideCancellationReview', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('inserts a payment-keyed review and warns when no audit row exists', async () => {
    const insert = vi.fn().mockResolvedValue({ error: null });
    const from = vi
      .fn()
      .mockReturnValueOnce(uncoveredQueries()[0])
      .mockReturnValueOnce(uncoveredQueries()[1])
      .mockReturnValue({ insert });
    const supabase = { from, rpc: vi.fn() } as unknown as SupabaseClient;

    await fileReferenceOnlyPaystackRefundOutsideCancellationReview(
      supabase,
      input()
    );

    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        issue_type: 'provider_refund_outside_cancellation',
        order_id: 'order-1',
        paystack_ref: null,
        metadata: expect.objectContaining({
          reference_only_refund_event: true,
          refund_evidence: {
            'payment:pay-1': expect.objectContaining({
              audit_record_failed: true,
              payment_transaction_id: 'pay-1',
              provider_refund_status: 'failed',
            }),
          },
        }),
        reason: expect.stringContaining('PSK-1'),
      })
    );
    expect(mocks.loggerWarn).toHaveBeenCalledWith(
      expect.objectContaining({ orderId: 'order-1', paymentId: 'pay-1' })
    );
  });

  it('stays silent when settled rows already reconcile the payment', async () => {
    const insert = vi.fn();
    const from = vi
      .fn()
      .mockReturnValueOnce(
        selectQuery([
          {
            amount: 100,
            currency: 'NGN',
            metadata: { provider_refund_status: 'processed' },
          },
        ])
      )
      .mockReturnValue({ insert });
    const supabase = { from, rpc: vi.fn() } as unknown as SupabaseClient;

    await fileReferenceOnlyPaystackRefundOutsideCancellationReview(
      supabase,
      input()
    );

    expect(insert).not.toHaveBeenCalled();
    expect(mocks.loggerWarn).not.toHaveBeenCalled();
  });

  it('merges payment-keyed evidence on redelivery conflict', async () => {
    const insert = vi
      .fn()
      .mockResolvedValue({ error: { code: '23505', message: 'duplicate' } });
    const rpc = vi.fn().mockResolvedValue({ data: true, error: null });
    const from = vi
      .fn()
      .mockReturnValueOnce(uncoveredQueries()[0])
      .mockReturnValueOnce(uncoveredQueries()[1])
      .mockReturnValue({ insert });
    const supabase = { from, rpc } as unknown as SupabaseClient;

    await fileReferenceOnlyPaystackRefundOutsideCancellationReview(
      supabase,
      input()
    );

    expect(rpc).toHaveBeenCalledWith(
      'merge_provider_refund_outside_cancellation_evidence_v1',
      expect.objectContaining({
        p_order_id: 'order-1',
        p_merchant_id: 'merchant-1',
        p_evidence_key: 'payment:pay-1',
        p_evidence: expect.objectContaining({
          audit_record_failed: true,
          payment_transaction_id: 'pay-1',
          provider_refund_status: 'failed',
          reference_only_refund_event: true,
        }),
      })
    );
  });

  it('throws for redelivery on write failures and failed merges', async () => {
    const queries = () => uncoveredQueries();
    const failingInsert = vi
      .fn()
      .mockResolvedValue({ error: { code: '42501', message: 'denied' } });
    const denied = {
      from: vi
        .fn()
        .mockReturnValueOnce(queries()[0])
        .mockReturnValueOnce(queries()[1])
        .mockReturnValue({ insert: failingInsert }),
      rpc: vi.fn(),
    } as unknown as SupabaseClient;

    await expect(
      fileReferenceOnlyPaystackRefundOutsideCancellationReview(denied, input())
    ).rejects.toThrow('reference_only_refund_review_persistence_failed');

    const conflictInsert = vi
      .fn()
      .mockResolvedValue({ error: { code: '23505', message: 'duplicate' } });
    const failedMerge = {
      from: vi
        .fn()
        .mockReturnValueOnce(queries()[0])
        .mockReturnValueOnce(queries()[1])
        .mockReturnValue({ insert: conflictInsert }),
      rpc: vi.fn().mockResolvedValue({ data: null, error: new Error('down') }),
    } as unknown as SupabaseClient;

    await expect(
      fileReferenceOnlyPaystackRefundOutsideCancellationReview(
        failedMerge,
        input()
      )
    ).rejects.toThrow('reference_only_refund_review_persistence_failed');
  });
});
