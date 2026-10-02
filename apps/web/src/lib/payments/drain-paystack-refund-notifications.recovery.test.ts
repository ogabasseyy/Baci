import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  sendEmail: vi.fn(),
}));

import { drainPaystackRefundNotifications } from './drain-paystack-refund-notifications';

import { database } from './drain-paystack-refund-notifications.test-support';

describe('Paystack refund notification recovery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.sendEmail.mockResolvedValue({ success: true, messageId: 'mail-1' });
  });

  it('totals every completed gateway leg in the customer email', async () => {
    const db = database('processed_customer_email', 'refunded', {
      payments: [
        { amount: 60, gateway: 'paystack', id: 'payment-1' },
        { amount: 45, gateway: 'korapay', id: 'payment-2' },
      ],
      refunds: [
        {
          amount: 60,
          currency: 'NGN',
          gateway: 'paystack',
          metadata: { payment_transaction_id: 'payment-1' },
        },
        {
          amount: 45,
          currency: 'NGN',
          gateway: 'korapay',
          metadata: { payment_transaction_id: 'payment-2' },
        },
      ],
    });
    await drainPaystackRefundNotifications(db as never, mocks.sendEmail);
    expect(mocks.sendEmail.mock.calls[0][0].textContent).toContain('105');
    expect(mocks.sendEmail.mock.calls[0][0].textContent).not.toContain(
      'Paystack'
    );
    expect(db.finish.update).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'sent' })
    );
  });

  it('fails the notification when a gateway leg has no linked refund', async () => {
    const db = database('processed_customer_email', 'refunded', {
      payments: [
        { amount: 60, gateway: 'paystack', id: 'payment-1' },
        { amount: 45, gateway: 'korapay', id: 'payment-2' },
      ],
      refunds: [
        {
          amount: 60,
          currency: 'NGN',
          gateway: 'paystack',
          metadata: { payment_transaction_id: 'payment-1' },
        },
      ],
    });
    await drainPaystackRefundNotifications(db as never, mocks.sendEmail);
    expect(mocks.sendEmail).not.toHaveBeenCalled();
    expect(db.finish.update).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'failed' })
    );
  });

  it('claims the next row only after finishing the previous one', async () => {
    const db = database('processed_customer_email');
    db.rpc.mockResolvedValueOnce({
      data: [
        {
          id: 'notification-1',
          order_id: 'order-1',
          merchant_id: 'merchant-1',
          event_type: 'processed_customer_email',
          claim_token: 'claim-2',
        },
      ],
      error: null,
    });
    await expect(
      drainPaystackRefundNotifications(db as never, mocks.sendEmail)
    ).resolves.toEqual({ claimed: 2, sent: 2, failed: 0, exhausted: 0 });
    expect(db.rpc).toHaveBeenCalledWith(
      'claim_paystack_cancellation_refund_notifications_v1',
      { p_limit: 1 }
    );
    const secondClaimOrder = db.rpc.mock.invocationCallOrder[1] as number;
    const firstFinishOrder = db.finish.update.mock
      .invocationCallOrder[0] as number;
    expect(firstFinishOrder).toBeLessThan(secondClaimOrder);
  });

  it.each([
    ['processed_customer_email', 'refund_customer_email_unknown'],
    ['processed_merchant_push', 'refund_merchant_email_unknown'],
  ])('preserves an unknown %s delivery outcome instead of retrying it', async (eventType, lastError) => {
    const db = database(eventType);
    mocks.sendEmail.mockResolvedValueOnce({
      success: false,
      deliveryOutcome: 'unknown',
    });
    await drainPaystackRefundNotifications(db as never, mocks.sendEmail);
    expect(mocks.sendEmail).toHaveBeenCalledTimes(1);
    expect(db.finish.update).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'delivery_uncertain',
        last_error: lastError,
      })
    );
  });
});
