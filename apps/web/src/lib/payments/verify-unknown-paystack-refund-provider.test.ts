import { beforeEach, describe, expect, it, vi } from 'vitest';
import { verifyUnknownPaystackRefundProvider } from './verify-unknown-paystack-refund-provider';

const mocks = vi.hoisted(() => ({
  fetchPaystackPaymentById: vi.fn(),
  fetchRefund: vi.fn(),
  loggerInfo: vi.fn(),
}));

vi.mock('./fetch-paystack-refund', () => ({
  fetchRefund: mocks.fetchRefund,
}));
vi.mock('./fetch-paystack-payment-by-id', () => ({
  fetchPaystackPaymentById: mocks.fetchPaystackPaymentById,
}));
vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), info: mocks.loggerInfo, warn: vi.fn() },
}));

const providerRefund = {
  amount: 10000,
  currency: 'NGN',
  id: 202,
  status: 'processed',
  transaction: 555,
};

describe('verifyUnknownPaystackRefundProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.fetchRefund.mockResolvedValue({
      data: providerRefund,
      success: true,
    });
    mocks.fetchPaystackPaymentById.mockResolvedValue({
      data: { id: 555, reference: 'PSK-1' },
      success: true,
    });
  });

  it('resolves the reference from the refund transaction', async () => {
    const result = await verifyUnknownPaystackRefundProvider(202, 'PSK-1');

    expect(mocks.fetchRefund).toHaveBeenCalledWith(
      202,
      expect.any(AbortSignal)
    );
    expect(mocks.fetchPaystackPaymentById).toHaveBeenCalledWith(
      555,
      expect.any(AbortSignal)
    );
    expect(result).toEqual({
      current: providerRefund,
      resolvedPaymentReference: 'PSK-1',
    });
    expect(mocks.loggerInfo).not.toHaveBeenCalled();
  });

  it('recovers through a stale hint and logs it', async () => {
    const result = await verifyUnknownPaystackRefundProvider(202, 'STALE-REF');

    expect(result.resolvedPaymentReference).toBe('PSK-1');
    expect(mocks.loggerInfo).toHaveBeenCalledWith(
      expect.objectContaining({ refundId: 202 })
    );
  });

  it('throws when provider verification is unavailable', async () => {
    mocks.fetchRefund.mockResolvedValue({
      code: 'NETWORK_ERROR',
      error: 'socket hangup',
      success: false,
    });

    await expect(verifyUnknownPaystackRefundProvider(202)).rejects.toThrow(
      'paystack_refund_verification_unavailable'
    );
    expect(mocks.fetchPaystackPaymentById).not.toHaveBeenCalled();
  });

  it('throws when the refund transaction is invalid', async () => {
    mocks.fetchRefund.mockResolvedValue({
      data: { ...providerRefund, transaction: 0 },
      success: true,
    });

    await expect(verifyUnknownPaystackRefundProvider(202)).rejects.toThrow(
      'paystack_refund_transaction_invalid'
    );
    expect(mocks.fetchPaystackPaymentById).not.toHaveBeenCalled();
  });

  it('throws for unavailable or mismatched payment lookups', async () => {
    mocks.fetchPaystackPaymentById.mockResolvedValueOnce({ success: false });

    await expect(verifyUnknownPaystackRefundProvider(202)).rejects.toThrow(
      'paystack_refund_payment_lookup_unavailable'
    );

    mocks.fetchPaystackPaymentById.mockResolvedValueOnce({
      data: { id: 999, reference: 'PSK-1' },
      success: true,
    });

    await expect(verifyUnknownPaystackRefundProvider(202)).rejects.toThrow(
      'paystack_refund_payment_lookup_mismatch'
    );
  });

  it('throws when the resolved reference is unusable downstream', async () => {
    mocks.fetchPaystackPaymentById.mockResolvedValue({
      data: { id: 555, reference: 'not a valid ref!' },
      success: true,
    });

    await expect(verifyUnknownPaystackRefundProvider(202)).rejects.toThrow(
      'paystack_refund_payment_reference_invalid'
    );
  });
});
