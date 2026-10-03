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

describe('fileReferenceOnlyPaystackRefundOutsideCancellationReview', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('inserts a payment-keyed review and warns when no audit row exists', async () => {
    const insert = vi.fn().mockResolvedValue({ error: null });
    const from = vi.fn().mockReturnValue({ insert });
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
            'payment:pay-1:failed': expect.objectContaining({
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

  it('files even when settled rows already cover the payment', async () => {
    const insert = vi.fn().mockResolvedValue({ error: null });
    const from = vi.fn().mockReturnValue({ insert });
    const supabase = { from, rpc: vi.fn() } as unknown as SupabaseClient;

    await fileReferenceOnlyPaystackRefundOutsideCancellationReview(
      supabase,
      input()
    );

    // The event carries no refund ID, so it can never be tied to a
    // recorded row: suppressing on coverage would hide a second
    // manual refund and its over-refund as a presumed duplicate.
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        issue_type: 'provider_refund_outside_cancellation',
        order_id: 'order-1',
      })
    );
  });

  it('keys evidence by verdict so a later refund cannot overwrite an earlier one', async () => {
    const insert = vi.fn().mockResolvedValue({ error: null });
    const from = vi.fn().mockReturnValue({ insert });
    const supabase = { from, rpc: vi.fn() } as unknown as SupabaseClient;

    await fileReferenceOnlyPaystackRefundOutsideCancellationReview(
      supabase,
      input({ providerRefundStatus: 'failed' })
    );
    await fileReferenceOnlyPaystackRefundOutsideCancellationReview(
      supabase,
      input({ providerRefundStatus: 'processed' })
    );

    const keys = insert.mock.calls.map(
      (call) => Object.keys(call[0].metadata.refund_evidence)[0]
    );
    expect(keys).toEqual(['payment:pay-1:failed', 'payment:pay-1:processed']);
  });

  it('merges payment-keyed evidence on redelivery conflict', async () => {
    const insert = vi
      .fn()
      .mockResolvedValue({ error: { code: '23505', message: 'duplicate' } });
    const rpc = vi.fn().mockResolvedValue({ data: true, error: null });
    const from = vi.fn().mockReturnValue({ insert });
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
        p_evidence_key: 'payment:pay-1:failed',
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
    const failingInsert = vi
      .fn()
      .mockResolvedValue({ error: { code: '42501', message: 'denied' } });
    const denied = {
      from: vi.fn().mockReturnValue({ insert: failingInsert }),
      rpc: vi.fn(),
    } as unknown as SupabaseClient;

    await expect(
      fileReferenceOnlyPaystackRefundOutsideCancellationReview(denied, input())
    ).rejects.toThrow('reference_only_refund_review_persistence_failed');

    const conflictInsert = vi
      .fn()
      .mockResolvedValue({ error: { code: '23505', message: 'duplicate' } });
    const failedMerge = {
      from: vi.fn().mockReturnValue({ insert: conflictInsert }),
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
