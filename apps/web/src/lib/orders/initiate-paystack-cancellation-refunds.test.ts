import { beforeEach, describe, expect, it, vi } from 'vitest';
import { initiatePaystackCancellationRefunds } from './initiate-paystack-cancellation-refunds';
import {
  initiationOrder,
  initiationTransaction,
  mockAcceptedRefund,
} from './initiate-paystack-cancellation-refunds.test-helpers';

const mocks = vi.hoisted(() => ({
  initiatePaystackRefund: vi.fn(),
  quarantineRefund: vi.fn(),
}));

vi.mock('@/lib/initiate-paystack-refund', () => ({
  initiateRefund: mocks.initiatePaystackRefund,
}));

vi.mock('./quarantine-order-cancellation-refund', () => ({
  quarantineRefund: mocks.quarantineRefund,
}));

vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

describe('initiatePaystackCancellationRefunds', () => {
  const insert = vi.fn();
  const supabase = { from: vi.fn(() => ({ insert })) } as never;
  const order = initiationOrder;
  const transaction = initiationTransaction;

  beforeEach(() => {
    vi.resetAllMocks();
    insert.mockResolvedValue({ error: null });
  });

  function acceptedRefund(overrides: Record<string, unknown> = {}) {
    mockAcceptedRefund(mocks.initiatePaystackRefund, overrides);
  }

  it('audits accepted refunds as refund_pending before returning', async () => {
    acceptedRefund();

    const refundIds = await initiatePaystackCancellationRefunds({
      order,
      refundedPaymentIds: new Set(),
      supabase,
      transactions: [transaction],
    });

    expect(refundIds).toEqual([101]);
    expect(mocks.initiatePaystackRefund).toHaveBeenCalledWith(
      'PSK-1',
      1250,
      'Order cancelled',
      undefined
    );
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        gateway_reference: '101',
        status: 'refund_pending',
        transaction_type: 'refund',
      })
    );
  });

  it.each([
    'failed',
    'needs-attention',
  ])('omits an immediate %s verdict from the audit row', async (status) => {
    acceptedRefund({ status });

    const refundIds = await initiatePaystackCancellationRefunds({
      order,
      refundedPaymentIds: new Set(),
      supabase,
      transactions: [transaction],
    });

    // Pre-populating the failure verdict would make the record RPC's
    // repeat guard return before transitioning the row or queuing the
    // merchant failure notification; the first reconcile applies it.
    expect(refundIds).toEqual([101]);
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.not.objectContaining({
          provider_refund_status: expect.anything(),
        }),
      })
    );
  });

  it('keeps a non-terminal provider status on the audit row', async () => {
    acceptedRefund({ status: 'queued' });

    await initiatePaystackCancellationRefunds({
      order,
      refundedPaymentIds: new Set(),
      supabase,
      transactions: [transaction],
    });

    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          provider_refund_status: 'queued',
        }),
      })
    );
  });

  it('skips legs already recorded as refunded', async () => {
    acceptedRefund();

    const refundIds = await initiatePaystackCancellationRefunds({
      order,
      refundedPaymentIds: new Set(['tx-1']),
      supabase,
      transactions: [transaction],
    });

    expect(refundIds).toEqual([]);
    expect(mocks.initiatePaystackRefund).not.toHaveBeenCalled();
    expect(insert).not.toHaveBeenCalled();
  });

  it('files the accepted provider ID for review when the audit row fails', async () => {
    acceptedRefund();
    insert.mockResolvedValue({ error: new Error('insert failed') });
    mocks.quarantineRefund.mockRejectedValue(new Error('quarantined'));

    await expect(
      initiatePaystackCancellationRefunds({
        order,
        refundedPaymentIds: new Set(),
        supabase,
        transactions: [transaction],
      })
    ).rejects.toThrow('quarantined');
    expect(mocks.quarantineRefund).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          audit_record_failed: true,
          provider_refund_id: 101,
        }),
      })
    );
  });

  it('treats a duplicate audit row as recorded without quarantining', async () => {
    acceptedRefund();
    insert.mockResolvedValue({ error: { code: '23505' } });
    const maybeSingle = vi.fn().mockResolvedValue({
      data: {
        amount: 12.5,
        currency: 'NGN',
        gateway: 'paystack',
        gateway_reference: '101',
        id: 'refund-1',
        metadata: { payment_transaction_id: 'tx-1' },
        transaction_type: 'refund',
      },
      error: null,
    });
    const local = {
      from: vi.fn(() => ({
        eq: vi.fn().mockReturnThis(),
        insert,
        maybeSingle,
        select: vi.fn().mockReturnThis(),
      })),
    } as never;

    const refundIds = await initiatePaystackCancellationRefunds({
      order,
      refundedPaymentIds: new Set(),
      supabase: local,
      transactions: [transaction],
    });

    expect(refundIds).toEqual([101]);
    expect(mocks.quarantineRefund).not.toHaveBeenCalled();
  });

  it('quarantines a cross-type reference collision instead of trusting it', async () => {
    acceptedRefund();
    insert.mockResolvedValue({ error: { code: '23505' } });
    mocks.quarantineRefund.mockRejectedValue(new Error('quarantined'));
    const maybeSingle = vi.fn().mockResolvedValue({
      data: {
        gateway: 'paystack',
        gateway_reference: '101',
        id: 'payment-other',
        transaction_type: 'payment',
      },
      error: null,
    });
    const local = {
      from: vi.fn(() => ({
        eq: vi.fn().mockReturnThis(),
        insert,
        maybeSingle,
        select: vi.fn().mockReturnThis(),
      })),
    } as never;

    await expect(
      initiatePaystackCancellationRefunds({
        order,
        refundedPaymentIds: new Set(),
        supabase: local,
        transactions: [transaction],
      })
    ).rejects.toThrow('quarantined');
    expect(mocks.quarantineRefund).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          audit_record_failed: true,
          payment_transaction_id: 'tx-1',
          provider_refund_id: 101,
        }),
      })
    );
  });
});
