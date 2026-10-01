import type { SupabaseClient } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { recordRecoveredPaystackRefund } from './record-recovered-paystack-refund';

const mocks = vi.hoisted(() => ({
  filePaystackRefundRecoveryReview: vi.fn(),
  fileProviderRefundOutsideCancellationReview: vi.fn(),
  loggerInfo: vi.fn(),
  lookupLocalRefundByProviderId: vi.fn(),
  reconcileRecoveredRow: vi.fn(),
}));

vi.mock('./file-paystack-refund-recovery-review', () => ({
  filePaystackRefundRecoveryReview: mocks.filePaystackRefundRecoveryReview,
}));
vi.mock('./file-provider-refund-outside-cancellation-review', () => ({
  fileProviderRefundOutsideCancellationReview:
    mocks.fileProviderRefundOutsideCancellationReview,
}));
vi.mock('./recover-unknown-paystack-refund-row', () => ({
  lookupLocalRefundByProviderId: mocks.lookupLocalRefundByProviderId,
  reconcileRecoveredRow: mocks.reconcileRecoveredRow,
}));
vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), info: mocks.loggerInfo, warn: vi.fn() },
}));

const payment = {
  amount: 100,
  gateway_reference: 'PSK-1',
  id: 'pay-1',
  merchant_id: 'merchant-1',
  order_id: 'order-1',
};
const current = {
  amount: 10000,
  currency: 'NGN',
  id: 202,
  status: 'processed',
  transaction: 555,
};
const evidence = {
  providerPaymentTransactionId: 555,
  providerRefundId: 202,
  providerRefundStatus: 'failed',
  reference: 'PSK-1',
};
const order = {
  cancelled_at: '2026-09-27T00:00:00Z',
  id: 'order-1',
  order_number: 'B-1',
  shipping_status: 'cancelled',
};

function orderQuery(data: unknown, error: unknown = null) {
  const query: {
    eq: ReturnType<typeof vi.fn>;
    maybeSingle: ReturnType<typeof vi.fn>;
  } = {
    eq: vi.fn(),
    maybeSingle: vi.fn().mockResolvedValue({ data, error }),
  };
  query.eq.mockReturnValue(query);
  return query;
}

function database({
  insertError = null,
  orderError = null,
  orderRow = order,
}: {
  insertError?: unknown;
  orderError?: unknown;
  orderRow?: unknown;
} = {}) {
  const insert = vi.fn().mockResolvedValue({ error: insertError });
  const from = vi
    .fn()
    .mockReturnValueOnce({
      select: vi.fn().mockReturnValue(orderQuery(orderRow, orderError)),
    })
    .mockReturnValue({ insert });
  return {
    from,
    insert,
    supabase: { from } as unknown as SupabaseClient,
  };
}

describe('recordRecoveredPaystackRefund', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('records the audit row and reconciles it', async () => {
    const { insert, supabase } = database();

    await recordRecoveredPaystackRefund(supabase, {
      current,
      evidence,
      payment,
      refundId: 202,
    });

    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: 100,
        currency: 'NGN',
        description: 'Refund for cancelled order #B-1',
        gateway: 'paystack',
        gateway_reference: '202',
        merchant_id: 'merchant-1',
        metadata: {
          payment_transaction_id: 'pay-1',
          provider_payment_transaction_id: 555,
          provider_refund_status: 'processed',
          recovered_from_provider_event: true,
        },
        order_id: 'order-1',
        status: 'refund_pending',
        transaction_type: 'refund',
      })
    );
    expect(mocks.reconcileRecoveredRow).toHaveBeenCalledWith(
      supabase,
      expect.objectContaining({
        gateway_reference: '202',
        merchant_id: 'merchant-1',
        order_id: 'order-1',
        status: 'refund_pending',
      })
    );
  });

  it('omits a failure verdict so the first reconcile applies the transition', async () => {
    const { insert, supabase } = database();

    await recordRecoveredPaystackRefund(supabase, {
      current: { ...current, status: 'failed' },
      evidence,
      payment,
      refundId: 202,
    });

    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: {
          payment_transaction_id: 'pay-1',
          provider_payment_transaction_id: 555,
          recovered_from_provider_event: true,
        },
      })
    );
    expect(mocks.reconcileRecoveredRow).toHaveBeenCalledOnce();
  });

  it('files for operations when the order is not cancelled', async () => {
    const { insert, supabase } = database({
      orderRow: { ...order, cancelled_at: null },
    });

    await recordRecoveredPaystackRefund(supabase, {
      current,
      evidence,
      payment,
      refundId: 202,
    });

    expect(
      mocks.fileProviderRefundOutsideCancellationReview
    ).toHaveBeenCalledWith(
      supabase,
      expect.objectContaining({
        orderId: 'order-1',
        paymentId: 'pay-1',
        providerRefundId: 202,
      })
    );
    expect(insert).not.toHaveBeenCalled();
    expect(mocks.reconcileRecoveredRow).not.toHaveBeenCalled();
  });

  it('returns quietly when the payment has no order', async () => {
    const { insert, supabase } = database({ orderRow: null });

    await recordRecoveredPaystackRefund(supabase, {
      current,
      evidence,
      payment,
      refundId: 202,
    });

    expect(mocks.loggerInfo).toHaveBeenCalledWith(
      expect.objectContaining({ refundId: 202 })
    );
    expect(insert).not.toHaveBeenCalled();
    expect(mocks.reconcileRecoveredRow).not.toHaveBeenCalled();
  });

  it('reconciles the winning row on conflict, else files a recovery review', async () => {
    const raced = {
      amount: 100,
      currency: 'NGN',
      gateway_reference: '202',
      id: 'refund-raced',
      merchant_id: 'merchant-1',
      metadata: {},
      order_id: 'order-1',
      status: 'refund_pending',
    };
    mocks.lookupLocalRefundByProviderId.mockResolvedValueOnce(raced);
    const first = database({ insertError: { code: '23505' } });

    await recordRecoveredPaystackRefund(first.supabase, {
      current,
      evidence,
      payment,
      refundId: 202,
    });

    expect(mocks.reconcileRecoveredRow).toHaveBeenCalledWith(
      first.supabase,
      raced
    );
    expect(mocks.filePaystackRefundRecoveryReview).not.toHaveBeenCalled();

    mocks.lookupLocalRefundByProviderId.mockResolvedValueOnce(null);
    const second = database({ insertError: { code: '23505' } });

    await recordRecoveredPaystackRefund(second.supabase, {
      current,
      evidence,
      payment,
      refundId: 202,
    });

    expect(mocks.filePaystackRefundRecoveryReview).toHaveBeenCalledWith(
      second.supabase,
      expect.objectContaining({
        orderId: 'order-1',
        paystackRef: '202',
        reason: expect.stringContaining('202'),
      })
    );
  });

  it('throws exact codes for order lookup and audit failures', async () => {
    const lookupFailed = database({ orderError: new Error('db down') });

    await expect(
      recordRecoveredPaystackRefund(lookupFailed.supabase, {
        current,
        evidence,
        payment,
        refundId: 202,
      })
    ).rejects.toThrow('refund_event_order_lookup_failed');

    const auditFailed = database({ insertError: new Error('db down') });

    await expect(
      recordRecoveredPaystackRefund(auditFailed.supabase, {
        current,
        evidence,
        payment,
        refundId: 202,
      })
    ).rejects.toThrow('refund_recovery_audit_failed');
  });
});
