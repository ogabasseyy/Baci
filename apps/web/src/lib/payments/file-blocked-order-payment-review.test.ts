import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fileBlockedOrderPaymentReview } from '@/lib/payments/file-blocked-order-payment-review';

const mocks = vi.hoisted(() => ({
  handlePaymentForCancelledOrder: vi.fn(),
}));

vi.mock('@/lib/payments/handle-payment-for-cancelled-order', () => ({
  handlePaymentForCancelledOrder: mocks.handlePaymentForCancelledOrder,
}));
vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn() },
}));

const baseArgs = {
  gateway: 'paystack',
  orderId: 'order-1',
  reference: 'REF-1',
  transactionGatewayReference: 'GATEWAY-REF-1',
  transactionId: 'txn-1',
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.handlePaymentForCancelledOrder.mockResolvedValue(true);
});

describe('fileBlockedOrderPaymentReview', () => {
  it('returns an applied strict partial without filing a blocked-order review', async () => {
    const outcome = await fileBlockedOrderPaymentReview({
      ...baseArgs,
      completion: {
        merchant_invoice_partial_recorded: true,
        order_number: 'ORD-1',
      } as never,
    });

    expect(outcome).toEqual({
      kind: 'partial_recorded',
      orderNumber: 'ORD-1',
    });
    expect(mocks.handlePaymentForCancelledOrder).not.toHaveBeenCalled();
  });

  it('files and returns the cancelled-order outcome', async () => {
    const outcome = await fileBlockedOrderPaymentReview({
      ...baseArgs,
      completion: {
        error_code: undefined,
        order_cancelled: true,
        order_number: 'ORD-1',
      } as never,
    });

    expect(outcome).toEqual({
      kind: 'order_cancelled',
      orderNumber: 'ORD-1',
    });
    expect(mocks.handlePaymentForCancelledOrder).toHaveBeenCalledWith(
      expect.objectContaining({ gatewayReference: 'GATEWAY-REF-1' })
    );
  });

  it('files a payment_received_after_refund review for a skipped status', async () => {
    const outcome = await fileBlockedOrderPaymentReview({
      ...baseArgs,
      completion: {
        order_cancelled: false,
        order_skipped_status: 'refunded',
      } as never,
    });

    expect(outcome).toEqual({
      kind: 'order_skipped',
      paymentStatus: 'refunded',
    });
    expect(mocks.handlePaymentForCancelledOrder).toHaveBeenCalledWith(
      expect.objectContaining({ issueType: 'payment_received_after_refund' })
    );
  });

  it('passes through an eligible order', async () => {
    const outcome = await fileBlockedOrderPaymentReview({
      ...baseArgs,
      completion: {
        order_cancelled: false,
        order_skipped_status: null,
      } as never,
    });

    expect(outcome).toBeNull();
    expect(mocks.handlePaymentForCancelledOrder).not.toHaveBeenCalled();
  });
});
