import type { SupabaseClient } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  fileInvalidPaystackRefundEvidenceReview,
  fileUnclaimedPaystackRefundCandidateReview,
} from './file-invalid-paystack-refund-evidence-review';

const mocks = vi.hoisted(() => ({ loggerWarn: vi.fn() }));

vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: mocks.loggerWarn },
}));

function input(overrides = {}) {
  return {
    evidence: {
      providerPaymentTransactionId: 555,
      providerRefundId: 202,
      providerRefundStatus: 'processed',
      reference: 'PSK-1',
    },
    reason:
      'Paystack refund 202 returned unusable provider evidence for reference PSK-1',
    reference: 'PSK-1',
    refundId: 202,
    ...overrides,
  };
}

describe('fileInvalidPaystackRefundEvidenceReview', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('files a reference-keyed generic review with no order or payment', async () => {
    const insert = vi.fn().mockResolvedValue({ error: null });
    const from = vi.fn().mockReturnValue({ insert });
    const supabase = { from, rpc: vi.fn() } as unknown as SupabaseClient;

    await fileInvalidPaystackRefundEvidenceReview(supabase, input());

    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        candidates: [],
        issue_type: 'paystack_refund_evidence_invalid',
        merchant_id: null,
        metadata: expect.objectContaining({
          provider_refund_id: 202,
          reference: 'PSK-1',
          refund_evidence: {
            'refund:202': expect.objectContaining({
              providerPaymentTransactionId: 555,
              providerRefundStatus: 'processed',
            }),
          },
        }),
        order_id: null,
        paystack_ref: 'PSK-1',
        txn_id: null,
      })
    );
    expect(mocks.loggerWarn).toHaveBeenCalledWith(
      expect.objectContaining({ refundId: 202, reference: 'PSK-1' })
    );
  });

  it('merges refund-keyed evidence on redelivery conflict', async () => {
    const insert = vi
      .fn()
      .mockResolvedValue({ error: { code: '23505', message: 'duplicate' } });
    const rpc = vi.fn().mockResolvedValue({ data: true, error: null });
    const from = vi.fn().mockReturnValue({ insert });
    const supabase = { from, rpc } as unknown as SupabaseClient;

    await fileInvalidPaystackRefundEvidenceReview(supabase, input());

    expect(rpc).toHaveBeenCalledWith(
      'merge_paystack_refund_evidence_invalid_v1',
      expect.objectContaining({
        p_paystack_ref: 'PSK-1',
        p_evidence_key: 'refund:202',
        p_evidence: expect.objectContaining({
          providerRefundStatus: 'processed',
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
      fileInvalidPaystackRefundEvidenceReview(denied, input())
    ).rejects.toThrow('invalid_refund_evidence_review_persistence_failed');

    const conflictInsert = vi
      .fn()
      .mockResolvedValue({ error: { code: '23505', message: 'duplicate' } });
    const failedMerge = {
      from: vi.fn().mockReturnValue({ insert: conflictInsert }),
      rpc: vi.fn().mockResolvedValue({ data: false, error: null }),
    } as unknown as SupabaseClient;

    await expect(
      fileInvalidPaystackRefundEvidenceReview(failedMerge, input())
    ).rejects.toThrow('invalid_refund_evidence_review_persistence_failed');
  });
});

describe('fileUnclaimedPaystackRefundCandidateReview', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('no-ops when both queues claimed every candidate', async () => {
    const from = vi.fn();
    const supabase = { from } as unknown as SupabaseClient;

    await fileUnclaimedPaystackRefundCandidateReview(supabase, {
      candidates: [{ id: 'pay-1' }, { id: 'pay-2' }],
      evidence: {
        providerPaymentTransactionId: 555,
        providerRefundId: 202,
        providerRefundStatus: 'processed',
        reference: 'PSK-1',
      },
      filed: [['pay-1'], ['pay-2']],
      reason:
        'Paystack refund 202 matches multiple completed payments for reference PSK-1',
      reference: 'PSK-1',
      refundId: 202,
    });

    expect(from).not.toHaveBeenCalled();
  });

  it('files one generic review listing every unclaimed payment id', async () => {
    const insert = vi.fn().mockResolvedValue({ error: null });
    const from = vi.fn().mockReturnValue({ insert });
    const supabase = { from } as unknown as SupabaseClient;

    await fileUnclaimedPaystackRefundCandidateReview(supabase, {
      candidates: [{ id: 'pay-1' }, { id: 'pay-detached' }],
      evidence: {
        providerPaymentTransactionId: 555,
        providerRefundId: 202,
        providerRefundStatus: 'processed',
        reference: 'PSK-1',
      },
      filed: [['pay-1'], []],
      reason:
        'Paystack refund 202 matches a non-completed local payment for reference PSK-1',
      reference: 'PSK-1',
      refundId: 202,
    });

    expect(from).toHaveBeenCalledWith('reconciliation_review');
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        issue_type: 'paystack_refund_evidence_invalid',
        order_id: null,
        paystack_ref: 'PSK-1',
        reason: expect.stringContaining('pay-detached'),
      })
    );
    // The claimed payment stays out of the detached list.
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: expect.not.stringContaining('pay-1,'),
      })
    );
  });
});
