import type { SupabaseClient } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fileDetachedReferenceOnlyPaystackRefundReview } from './file-detached-reference-only-paystack-refund-review';

const mocks = {
  loggerWarn: vi.fn(),
};

vi.mock('@/lib/logger', () => ({
  logger: {
    error: vi.fn(),
    info: vi.fn(),
    warn: (...args: unknown[]) => mocks.loggerWarn(...args),
  },
}));

describe('fileDetachedReferenceOnlyPaystackRefundReview', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('files the detached match into the order-independent queue', async () => {
    const insert = vi.fn().mockResolvedValue({ error: null });
    const supabase = {
      from: vi.fn().mockReturnValue({ insert }),
      rpc: vi.fn(),
    } as unknown as SupabaseClient;

    await fileDetachedReferenceOnlyPaystackRefundReview(supabase, {
      paymentId: 'pay-9',
      paymentReference: 'PSK-9',
      providerRefundStatus: 'processed',
    });

    expect(supabase.from).toHaveBeenCalledWith('reconciliation_review');
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        issue_type: 'paystack_refund_evidence_invalid',
        order_id: null,
        paystack_ref: 'PSK-9',
        reason: expect.stringContaining('detached from any order'),
        metadata: expect.objectContaining({
          payment_transaction_id: 'pay-9',
          reference_only_refund_event: true,
          refund_evidence: {
            'payment:pay-9': expect.objectContaining({
              provider_refund_status: 'processed',
            }),
          },
        }),
      })
    );
    expect(mocks.loggerWarn).toHaveBeenCalledWith(
      expect.objectContaining({ paymentId: 'pay-9' })
    );
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it('merges redeliveries under the payment key', async () => {
    const insert = vi.fn().mockResolvedValue({ error: { code: '23505' } });
    const rpc = vi.fn().mockResolvedValue({ data: true, error: null });
    const supabase = {
      from: vi.fn().mockReturnValue({ insert }),
      rpc,
    } as unknown as SupabaseClient;

    await fileDetachedReferenceOnlyPaystackRefundReview(supabase, {
      paymentId: 'pay-9',
      paymentReference: 'PSK-9',
      providerRefundStatus: 'processed',
    });

    expect(rpc).toHaveBeenCalledWith(
      'merge_paystack_refund_evidence_invalid_v1',
      expect.objectContaining({
        p_paystack_ref: 'PSK-9',
        p_evidence_key: 'payment:pay-9',
      })
    );
  });

  it('throws for redelivery when persistence fails', async () => {
    const insert = vi.fn().mockResolvedValue({ error: { code: 'XX000' } });
    const supabase = {
      from: vi.fn().mockReturnValue({ insert }),
      rpc: vi.fn(),
    } as unknown as SupabaseClient;

    await expect(
      fileDetachedReferenceOnlyPaystackRefundReview(supabase, {
        paymentId: 'pay-9',
        paymentReference: 'PSK-9',
        providerRefundStatus: 'processed',
      })
    ).rejects.toThrow('detached_reference_refund_review_persistence_failed');
  });

  it('throws for redelivery when the merge fails', async () => {
    const insert = vi.fn().mockResolvedValue({ error: { code: '23505' } });
    const rpc = vi
      .fn()
      .mockResolvedValue({ data: null, error: { code: 'XX000' } });
    const supabase = {
      from: vi.fn().mockReturnValue({ insert }),
      rpc,
    } as unknown as SupabaseClient;

    await expect(
      fileDetachedReferenceOnlyPaystackRefundReview(supabase, {
        paymentId: 'pay-9',
        paymentReference: 'PSK-9',
        providerRefundStatus: 'processed',
      })
    ).rejects.toThrow('detached_reference_refund_review_persistence_failed');
  });
});
