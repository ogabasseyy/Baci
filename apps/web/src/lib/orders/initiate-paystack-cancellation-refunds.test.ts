import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GatewayPaymentTransaction } from './gateway-payment-transaction';
import { initiatePaystackCancellationRefunds } from './initiate-paystack-cancellation-refunds';

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
  const order = {
    currency: 'NGN',
    id: 'order-1',
    merchant_id: 'merchant-1',
    order_number: 'B-1',
  };
  const transaction: GatewayPaymentTransaction = {
    amount: 12.5,
    currency: 'NGN',
    gateway: 'paystack',
    gateway_reference: 'PSK-1',
    id: 'tx-1',
  } as GatewayPaymentTransaction;

  beforeEach(() => {
    vi.resetAllMocks();
    insert.mockResolvedValue({ error: null });
  });

  function acceptedRefund(overrides: Record<string, unknown> = {}) {
    mocks.initiatePaystackRefund.mockResolvedValue({
      data: {
        id: 101,
        status: 'queued',
        transaction: { id: 55, reference: 'PSK-1' },
        ...overrides,
      },
      success: true,
    });
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
      'Order cancelled'
    );
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        gateway_reference: '101',
        status: 'refund_pending',
        transaction_type: 'refund',
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

  it('throws a retriable error on ambiguous provider failures', async () => {
    mocks.initiatePaystackRefund.mockResolvedValue({
      code: 'NETWORK_ERROR',
      error: 'socket hangup',
      success: false,
    });

    const result = initiatePaystackCancellationRefunds({
      order,
      refundedPaymentIds: new Set(),
      supabase,
      transactions: [transaction],
    });

    await expect(result).rejects.toThrow('socket hangup');
    expect(mocks.quarantineRefund).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          failed_payment_transaction_id: 'tx-1',
        }),
      })
    );
  });
});
