import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ initiateRefund: vi.fn() }));

vi.mock('@/lib/paystack', () => ({ initiateRefund: mocks.initiateRefund }));
vi.mock('@/lib/orders/build-order-cancellation-email-message', () => ({
  buildOrderCancellationEmailMessage: vi.fn(),
}));

import { executeOrderCancellationSideEffect } from './execute-order-cancellation-side-effect';
import { DeliveryUncertainError } from './run-order-cancellation-side-effect';

const merchant = {
  business_name: 'Store',
  cac_rc_number: null,
  email: 'store@example.com',
  email_sender_name: null,
  id: 'merchant-1',
  slug: 'store',
  support_email: null,
  tax_identification_number: null,
};
const order = {
  amount_paid: 100,
  currency: 'NGN',
  customer_email: 'buyer@example.com',
  customer_id: null,
  customer_name: 'Buyer',
  id: 'order-1',
  merchant_id: 'merchant-1',
  order_items: [],
  order_number: 'ORD-1',
  payment_status: 'paid',
  total: 100,
};

function transactionQuery(data: unknown) {
  return {
    eq: vi.fn().mockReturnThis(),
    order: vi.fn().mockResolvedValue({ data, error: null }),
    select: vi.fn().mockReturnThis(),
  };
}

describe('cancellation refund audit recovery', () => {
  beforeEach(() => vi.clearAllMocks());

  it('persists the provider refund id when its audit row cannot be recorded', async () => {
    const auditInsert = vi
      .fn()
      .mockResolvedValue({ error: { message: 'db unavailable' } });
    const reviewInsert = vi.fn().mockResolvedValue({ error: null });
    const from = vi
      .fn()
      .mockReturnValueOnce(
        transactionQuery([
          {
            amount: 100,
            currency: 'NGN',
            gateway: 'paystack',
            gateway_reference: 'paystack-ref',
            id: 'payment-1',
          },
        ])
      )
      .mockReturnValueOnce(transactionQuery([]))
      .mockReturnValueOnce({ insert: auditInsert })
      .mockReturnValueOnce({ insert: reviewInsert });
    mocks.initiateRefund.mockResolvedValue({
      data: {
        id: 45,
        status: 'pending',
        transaction: { id: 123, reference: 'paystack-ref' },
      },
      success: true,
    });

    await expect(
      executeOrderCancellationSideEffect({
        merchant,
        order,
        step: 'refund',
        supabase: { from } as never,
      })
    ).rejects.toBeInstanceOf(DeliveryUncertainError);
    expect(reviewInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        issue_type: 'order_cancellation_refund_requires_review',
        metadata: expect.objectContaining({
          provider_refund_id: 45,
          payment_transaction_id: 'payment-1',
          audit_record_failed: true,
        }),
      })
    );
  });

  it('retries when a pending-refund preflight review cannot be persisted', async () => {
    const reviewInsert = vi
      .fn()
      .mockResolvedValue({ error: { code: 'XX000' } });
    const from = vi
      .fn()
      .mockReturnValueOnce(
        transactionQuery([
          {
            amount: 100,
            currency: 'NGN',
            gateway: 'paystack',
            gateway_reference: 'paystack-ref',
            id: 'payment-1',
          },
        ])
      )
      .mockReturnValueOnce(
        transactionQuery([
          {
            metadata: { payment_transaction_id: 'payment-1' },
            status: 'refund_pending',
          },
        ])
      )
      .mockReturnValueOnce({ insert: reviewInsert });

    const error = await executeOrderCancellationSideEffect({
      merchant,
      order,
      step: 'refund',
      supabase: { from } as never,
    }).catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(DeliveryUncertainError);
    expect(mocks.initiateRefund).not.toHaveBeenCalled();
  });

  it('records an accepted refund with mismatched payment evidence before quarantining it', async () => {
    const auditInsert = vi.fn().mockResolvedValue({ error: null });
    const reviewInsert = vi.fn().mockResolvedValue({ error: null });
    const from = vi
      .fn()
      .mockReturnValueOnce(
        transactionQuery([
          {
            amount: 100,
            currency: 'NGN',
            gateway: 'paystack',
            gateway_reference: 'paystack-ref',
            id: 'payment-1',
          },
        ])
      )
      .mockReturnValueOnce(transactionQuery([]))
      .mockReturnValueOnce({ insert: auditInsert })
      .mockReturnValueOnce({ insert: reviewInsert });
    mocks.initiateRefund.mockResolvedValue({
      success: true,
      data: {
        id: 44,
        status: 'pending',
        transaction: { id: 456, reference: 'another-payment' },
      },
    });
    await expect(
      executeOrderCancellationSideEffect({
        merchant,
        order,
        step: 'refund',
        supabase: { from } as never,
      })
    ).rejects.toBeInstanceOf(DeliveryUncertainError);
    expect(auditInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        gateway_reference: '44',
        status: 'refund_pending',
        metadata: expect.objectContaining({
          provider_payment_transaction_id: 456,
          refund_reconciliation_hold: 'provider_creation_evidence_mismatch',
        }),
      })
    );
    expect(reviewInsert).toHaveBeenCalledOnce();
  });

  it('keeps an accepted refund uncertain when filing its review fails', async () => {
    const refundInsert = vi.fn().mockResolvedValue({ error: null });
    const reviewInsert = vi
      .fn()
      .mockResolvedValue({ error: { message: 'db unavailable' } });
    const from = vi
      .fn()
      .mockReturnValueOnce(
        transactionQuery([
          {
            amount: 100,
            currency: 'NGN',
            gateway: 'paystack',
            gateway_reference: 'paystack-ref',
            id: 'payment-1',
          },
        ])
      )
      .mockReturnValueOnce(transactionQuery([]))
      .mockReturnValueOnce({ insert: refundInsert })
      .mockReturnValueOnce({ insert: reviewInsert });
    mocks.initiateRefund.mockResolvedValue({
      data: {
        id: 43,
        status: 'pending',
        transaction: { id: 123, reference: 'another-payment' },
      },
      success: true,
    });
    await expect(
      executeOrderCancellationSideEffect({
        merchant,
        order,
        step: 'refund',
        supabase: { from } as never,
      })
    ).rejects.toBeInstanceOf(DeliveryUncertainError);
    expect(mocks.initiateRefund).toHaveBeenCalledTimes(1);
  });
});
