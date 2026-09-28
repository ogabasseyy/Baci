import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  loggerError: vi.fn(),
  sendEmail: vi.fn(),
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    error: mocks.loggerError,
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

import { drainPaystackRefundNotifications } from './drain-paystack-refund-notifications';

import { database } from './drain-paystack-refund-notifications.test-support';

describe('Paystack refund notifications', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.sendEmail.mockResolvedValue({ success: true, messageId: 'mail-1' });
  });

  it('emails the customer after the whole order is refunded', async () => {
    const db = database('processed_customer_email');
    await expect(
      drainPaystackRefundNotifications(db as never, mocks.sendEmail)
    ).resolves.toEqual({
      claimed: 1,
      sent: 1,
      failed: 0,
      exhausted: 0,
    });
    expect(mocks.sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'buyer@example.com',
        subject: 'Refund processed for order #ORD-1',
        textContent: expect.stringContaining('10 business days'),
      })
    );
    expect(mocks.sendEmail.mock.calls[0][0].htmlContent).not.toContain(
      '<Buyer>'
    );
    expect(mocks.sendEmail.mock.calls[0][0].textContent).toContain('60');
    expect(db.finish.update).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'sent' })
    );
  });

  it('does not email before every payment leg is refunded', async () => {
    const db = database('processed_customer_email', 'paid');
    await drainPaystackRefundNotifications(db as never, mocks.sendEmail);
    expect(mocks.sendEmail).not.toHaveBeenCalled();
    expect(db.finish.update).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'delivery_uncertain' })
    );
  });

  it('emails after an unlinked legacy refund matches the sole payment leg', async () => {
    const db = database('processed_customer_email', 'refunded', {
      payments: [{ amount: 60, gateway: 'paystack', id: 'payment-1' }],
      refunds: [
        { amount: 60, currency: 'NGN', gateway: 'paystack', metadata: {} },
      ],
    });
    await expect(
      drainPaystackRefundNotifications(db as never, mocks.sendEmail)
    ).resolves.toEqual({ claimed: 1, sent: 1, failed: 0, exhausted: 0 });
    expect(mocks.sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'buyer@example.com' })
    );
    expect(db.finish.update).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'sent' })
    );
  });

  it('holds an unlinked legacy refund when several payment legs exist', async () => {
    const db = database('processed_customer_email', 'refunded', {
      payments: [
        { amount: 60, gateway: 'paystack', id: 'payment-1' },
        { amount: 40, gateway: 'paystack', id: 'payment-2' },
      ],
      refunds: [
        { amount: 60, currency: 'NGN', gateway: 'paystack', metadata: {} },
        {
          amount: 40,
          currency: 'NGN',
          gateway: 'paystack',
          metadata: { payment_transaction_id: 'payment-2' },
        },
      ],
    });
    await drainPaystackRefundNotifications(db as never, mocks.sendEmail);
    expect(mocks.sendEmail).not.toHaveBeenCalled();
    expect(db.finish.update).toHaveBeenCalledWith(
      expect.objectContaining({
        last_error: 'refund_notification_ledger_mismatch',
        status: 'failed',
      })
    );
  });

  it('totals self-terminal refunded legs with linked refunds', async () => {
    const db = database('processed_customer_email', 'refunded', {
      payments: [
        { amount: 60, gateway: 'paystack', id: 'payment-1' },
        {
          amount: 40,
          currency: 'NGN',
          gateway: 'paypal',
          id: 'payment-2',
          status: 'refunded',
        },
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
    await expect(
      drainPaystackRefundNotifications(db as never, mocks.sendEmail)
    ).resolves.toEqual({ claimed: 1, sent: 1, failed: 0, exhausted: 0 });
    expect(mocks.sendEmail.mock.calls[0][0].textContent).toContain('100');
    expect(db.finish.update).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'sent' })
    );
  });

  it('notifies the merchant on refund completion', async () => {
    const db = database('processed_merchant_push');
    await drainPaystackRefundNotifications(db as never, mocks.sendEmail);
    expect(mocks.sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'merchant@example.com',
        subject: 'Refund processed: order #ORD-1',
      })
    );
  });

  it('records merchant delivery after an accepted email', async () => {
    const db = database('processed_merchant_push');
    await drainPaystackRefundNotifications(db as never, mocks.sendEmail);
    expect(mocks.sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'merchant@example.com',
        subject: 'Refund processed: order #ORD-1',
      })
    );
    expect(db.finish.update).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'sent' })
    );
  });

  it('keeps a rejected merchant email available for retry', async () => {
    const db = database('processed_merchant_push');
    mocks.sendEmail.mockResolvedValueOnce({ success: false });
    await drainPaystackRefundNotifications(db as never, mocks.sendEmail);
    expect(mocks.sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'merchant@example.com' })
    );
    expect(db.finish.update).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'failed' })
    );
  });

  it('alerts the merchant when a refund fails before any leg completes', async () => {
    const db = database('failed_merchant_push', 'paid');
    await drainPaystackRefundNotifications(db as never, mocks.sendEmail);
    expect(db.from).not.toHaveBeenCalledWith('transactions');
    expect(mocks.sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'merchant@example.com',
        subject: 'Refund needs attention: order #ORD-1',
      })
    );
    expect(db.finish.update).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'sent' })
    );
  });

  it('keeps a rejected email available for retry', async () => {
    const db = database('processed_customer_email');
    mocks.sendEmail.mockResolvedValueOnce({
      success: false,
      error: 'rejected',
    });
    await drainPaystackRefundNotifications(db as never, mocks.sendEmail);
    expect(db.finish.update).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'failed' })
    );
  });

  it('totals refund-pending legs with linked completed refunds', async () => {
    const db = database('processed_customer_email', 'refunded', {
      payments: [
        { amount: 60, gateway: 'paystack', id: 'payment-1' },
        {
          amount: 40,
          gateway: 'paystack',
          id: 'payment-2',
          status: 'refund_pending',
        },
      ],
      refunds: [
        {
          amount: 60,
          currency: 'NGN',
          gateway: 'paystack',
          metadata: { payment_transaction_id: 'payment-1' },
        },
        {
          amount: 40,
          currency: 'NGN',
          gateway: 'paystack',
          metadata: { payment_transaction_id: 'payment-2' },
        },
      ],
    });
    await expect(
      drainPaystackRefundNotifications(db as never, mocks.sendEmail)
    ).resolves.toEqual({ claimed: 1, sent: 1, failed: 0, exhausted: 0 });
    expect(mocks.sendEmail.mock.calls[0][0].textContent).toContain('100');
    expect(db.finish.update).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'sent' })
    );
  });

  it('reports notifications that exhausted their retries', async () => {
    const db = database('processed_customer_email');
    db.finish.limit.mockResolvedValueOnce({
      data: [{ event_type: 'processed_customer_email', order_id: 'order-9' }],
      count: 1,
      error: null,
    });

    const summary = await drainPaystackRefundNotifications(
      db as never,
      mocks.sendEmail
    );

    expect(summary.exhausted).toBe(1);
    expect(db.finish.select).toHaveBeenCalledWith(
      'order_id, event_type',
      expect.objectContaining({ count: 'exact' })
    );
    expect(db.finish.gte).toHaveBeenCalledWith('attempts', 5);
    expect(mocks.loggerError).toHaveBeenCalledWith(
      expect.objectContaining({ exhausted: 1 })
    );
  });
});
