import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import { quarantineRefund } from './quarantine-order-cancellation-refund';
import { DeliveryUncertainError } from './run-order-cancellation-side-effect';

const transaction = {
  amount: 100,
  currency: 'NGN',
  gateway: 'paystack',
  gateway_reference: 'PAY-123',
  id: 'payment-id',
};
const order = { currency: 'NGN', id: 'order-id', merchant_id: 'merchant-id' };

describe('quarantineRefund', () => {
  it('keeps a preflight review-write failure retryable', async () => {
    const insert = vi.fn().mockResolvedValue({ error: { code: 'XX000' } });
    const supabase = {
      from: vi.fn().mockReturnValue({ insert }),
    } as unknown as Pick<SupabaseClient, 'from' | 'rpc'>;

    const error = await quarantineRefund({
      order,
      preflight: true,
      reason: 'unsupported gateway',
      supabase,
      transactions: [transaction],
    }).catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(DeliveryUncertainError);
    expect((error as Error).message).toMatch('filing the review failed');
  });

  it('keeps a duplicate preflight review quarantined', async () => {
    const insert = vi.fn().mockResolvedValue({ error: { code: '23505' } });
    const rpc = vi.fn().mockResolvedValue({ data: true, error: null });
    const supabase = {
      from: vi.fn().mockReturnValue({ insert }),
      rpc,
    } as unknown as Pick<SupabaseClient, 'from' | 'rpc'>;

    await expect(
      quarantineRefund({
        order,
        preflight: true,
        reason: 'unsupported gateway',
        supabase,
        transactions: [transaction],
      })
    ).rejects.toBeInstanceOf(DeliveryUncertainError);
  });

  it('merges provider evidence into an existing review on conflict', async () => {
    const insert = vi.fn().mockResolvedValue({ error: { code: '23505' } });
    const rpc = vi.fn().mockResolvedValue({ data: true, error: null });
    const supabase = {
      from: vi.fn().mockReturnValue({ insert }),
      rpc,
    } as unknown as Pick<SupabaseClient, 'from' | 'rpc'>;

    await expect(
      quarantineRefund({
        metadata: {
          audit_record_failed: true,
          payment_transaction_id: 'payment-id',
          provider_refund_id: 123,
        },
        order,
        reason: 'Paystack accepted refund but its local audit record failed',
        supabase,
        transactions: [transaction],
      })
    ).rejects.toBeInstanceOf(DeliveryUncertainError);
    expect(rpc).toHaveBeenCalledWith(
      'merge_paystack_cancellation_refund_provider_evidence_v1',
      expect.objectContaining({
        p_merchant_id: 'merchant-id',
        p_order_id: 'order-id',
        p_payment_transaction_id: 'payment-id',
        p_provider_refund_id: 123,
      })
    );
    expect(rpc).toHaveBeenCalledWith(
      'merge_paystack_cancellation_refund_leg_evidence_v1',
      expect.objectContaining({
        p_merchant_id: 'merchant-id',
        p_order_id: 'order-id',
        p_payment_transaction_id: 'payment-id',
      })
    );
  });

  it('keeps an accepted refund uncertain when merging its evidence fails', async () => {
    const insert = vi.fn().mockResolvedValue({ error: { code: '23505' } });
    const rpc = vi.fn().mockResolvedValue({ data: false, error: null });
    const supabase = {
      from: vi.fn().mockReturnValue({ insert }),
      rpc,
    } as unknown as Pick<SupabaseClient, 'from' | 'rpc'>;

    const error = await quarantineRefund({
      metadata: {
        payment_transaction_id: 'payment-id',
        provider_refund_id: 123,
      },
      order,
      reason: 'Paystack accepted refund but its local audit record failed',
      supabase,
      transactions: [transaction],
    }).catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(DeliveryUncertainError);
    expect((error as Error).message).toMatch('merging its recovery evidence');
  });

  it('forwards ambiguous initiation into the merged leg evidence', async () => {
    const insert = vi.fn().mockResolvedValue({ error: { code: '23505' } });
    const rpc = vi.fn().mockResolvedValue({ data: true, error: null });
    const supabase = {
      from: vi.fn().mockReturnValue({ insert }),
      rpc,
    } as unknown as Pick<SupabaseClient, 'from' | 'rpc'>;

    await expect(
      quarantineRefund({
        metadata: {
          ambiguous_initiation: true,
          failed_payment_transaction_id: 'payment-id',
        },
        order,
        reason:
          'Paystack refund initiation failed ambiguously and may already exist for this payment leg',
        supabase,
        transactions: [transaction],
      })
    ).rejects.toBeInstanceOf(DeliveryUncertainError);
    expect(rpc).toHaveBeenCalledWith(
      'merge_paystack_cancellation_refund_leg_evidence_v1',
      expect.objectContaining({
        p_ambiguous: true,
        p_payment_transaction_id: 'payment-id',
      })
    );
  });

  it('merges leg evidence on conflict without provider evidence', async () => {
    const insert = vi.fn().mockResolvedValue({ error: { code: '23505' } });
    const rpc = vi.fn().mockResolvedValue({ data: true, error: null });
    const supabase = {
      from: vi.fn().mockReturnValue({ insert }),
      rpc,
    } as unknown as Pick<SupabaseClient, 'from' | 'rpc'>;

    await expect(
      quarantineRefund({
        order,
        reason: 'unsupported gateway',
        supabase,
        transactions: [transaction],
      })
    ).rejects.toBeInstanceOf(DeliveryUncertainError);
    expect(rpc).toHaveBeenCalledWith(
      'merge_paystack_cancellation_refund_leg_evidence_v1',
      expect.objectContaining({
        p_ambiguous: false,
      })
    );
    expect(rpc).not.toHaveBeenCalledWith(
      'merge_paystack_cancellation_refund_provider_evidence_v1',
      expect.anything()
    );
    expect(rpc).toHaveBeenCalledWith(
      'merge_paystack_cancellation_refund_leg_evidence_v1',
      expect.objectContaining({
        p_accepted_refund_ids: null,
        p_merchant_id: 'merchant-id',
        p_order_id: 'order-id',
        p_payment_transaction_id: 'payment-id',
        p_reason: 'unsupported gateway',
      })
    );
  });

  it('merges failed-leg evidence with accepted refund IDs', async () => {
    const insert = vi.fn().mockResolvedValue({ error: { code: '23505' } });
    const rpc = vi.fn().mockResolvedValue({ data: true, error: null });
    const supabase = {
      from: vi.fn().mockReturnValue({ insert }),
      rpc,
    } as unknown as Pick<SupabaseClient, 'from' | 'rpc'>;

    await expect(
      quarantineRefund({
        metadata: {
          accepted_refund_ids: [101],
          failed_payment_transaction_id: 'payment-2',
        },
        order,
        reason: 'Paystack refund initiation failed',
        supabase,
        transactions: [{ ...transaction, id: 'payment-2' }],
      })
    ).rejects.toBeInstanceOf(DeliveryUncertainError);
    expect(rpc).toHaveBeenCalledWith(
      'merge_paystack_cancellation_refund_leg_evidence_v1',
      expect.objectContaining({
        p_accepted_refund_ids: [101],
        p_candidates: [
          expect.objectContaining({ paymentTransactionId: 'payment-2' }),
        ],
        p_payment_transaction_id: 'payment-2',
      })
    );
  });

  it('keeps the step uncertain when merging leg evidence fails', async () => {
    const insert = vi.fn().mockResolvedValue({ error: { code: '23505' } });
    const rpc = vi.fn().mockResolvedValue({ data: false, error: null });
    const supabase = {
      from: vi.fn().mockReturnValue({ insert }),
      rpc,
    } as unknown as Pick<SupabaseClient, 'from' | 'rpc'>;

    const error = await quarantineRefund({
      metadata: { failed_payment_transaction_id: 'payment-id' },
      order,
      reason: 'Paystack refund initiation failed',
      supabase,
      transactions: [transaction],
    }).catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(DeliveryUncertainError);
    expect((error as Error).message).toMatch('merging its recovery evidence');
  });

  it('keeps an accepted refund uncertain when review persistence fails', async () => {
    const insert = vi.fn().mockResolvedValue({ error: { code: '42501' } });
    const supabase = {
      from: vi.fn().mockReturnValue({ insert }),
    } as unknown as Pick<SupabaseClient, 'from' | 'rpc'>;

    await expect(
      quarantineRefund({
        metadata: { provider_refund_id: 123 },
        order,
        reason: 'provider evidence mismatch',
        supabase,
        transactions: [transaction],
      })
    ).rejects.toBeInstanceOf(DeliveryUncertainError);
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        candidates: expect.arrayContaining([
          expect.objectContaining({ gatewayReference: 'PAY-123' }),
        ]),
        issue_type: 'order_cancellation_refund_requires_review',
        metadata: { provider_refund_id: 123 },
        // The open-by-paystack-ref index is global: stamping the shared
        // reference would collide with another order's review while the
        // merge RPCs only search this order.
        paystack_ref: null,
      })
    );
  });
});
