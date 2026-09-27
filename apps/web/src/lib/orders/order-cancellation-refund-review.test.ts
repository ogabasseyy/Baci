import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import {
  isExternalPaymentGateway,
  quarantineRefund,
  unsupportedRefundReasons,
} from './order-cancellation-refund-review';
import { DeliveryUncertainError } from './run-order-cancellation-side-effect';

const transaction = {
  amount: 100,
  currency: 'NGN',
  gateway: 'paystack',
  gateway_reference: 'PAY-123',
  id: 'payment-id',
};
const order = { currency: 'NGN', id: 'order-id', merchant_id: 'merchant-id' };

describe('order cancellation refund review', () => {
  it('distinguishes external payment legs and summarizes unsupported reasons', () => {
    expect(isExternalPaymentGateway('wallet')).toBe(false);
    expect(isExternalPaymentGateway('paystack')).toBe(true);
    expect(isExternalPaymentGateway(null)).toBe(true);
    expect(
      unsupportedRefundReasons([
        { ...transaction, gateway: null },
        { ...transaction, gateway: 'korapay', gateway_reference: null },
        { ...transaction, gateway: 'korapay', gateway_reference: null },
      ])
    ).toEqual(['missing gateway', 'korapay missing reference']);
  });

  it('keeps a preflight review-write failure retryable', async () => {
    const insert = vi.fn().mockResolvedValue({ error: { code: 'XX000' } });
    const supabase = {
      from: vi.fn().mockReturnValue({ insert }),
    } as unknown as Pick<SupabaseClient, 'from'>;

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
    const supabase = {
      from: vi.fn().mockReturnValue({ insert }),
    } as unknown as Pick<SupabaseClient, 'from'>;

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

  it('keeps an accepted refund uncertain when review persistence fails', async () => {
    const insert = vi.fn().mockResolvedValue({ error: { code: '42501' } });
    const supabase = {
      from: vi.fn().mockReturnValue({ insert }),
    } as unknown as Pick<SupabaseClient, 'from'>;

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
        issue_type: 'order_cancellation_refund_requires_review',
        metadata: { provider_refund_id: 123 },
        paystack_ref: 'PAY-123',
      })
    );
  });
});
