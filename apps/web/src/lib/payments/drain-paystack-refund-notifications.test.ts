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
      uncertain: 0,
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

  it('threads the mail fallback deadline from the drain deadline', async () => {
    const db = database('processed_customer_email');
    const deadlineMs = Date.now() + 200_000;

    await drainPaystackRefundNotifications(
      db as never,
      mocks.sendEmail,
      20,
      undefined,
      deadlineMs
    );

    expect(mocks.sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({ fallbackDeadlineMs: deadlineMs - 10_000 })
    );
  });

  it('releases the row unattempted when the admission check refuses it', async () => {
    const db = database('processed_customer_email');
    // 100s clears the 45s claim floor but not the 145s admission
    // budget: the row claims, the admission check refuses it, and the
    // finish releases it back to pending with the attempt un-burned
    // instead of collapsing it to failed toward dead-letter.
    const deadlineMs = Date.now() + 100_000;

    await expect(
      drainPaystackRefundNotifications(
        db as never,
        mocks.sendEmail,
        20,
        undefined,
        deadlineMs
      )
    ).resolves.toEqual({
      claimed: 1,
      sent: 0,
      failed: 0,
      exhausted: 0,
      uncertain: 0,
    });
    expect(mocks.sendEmail).not.toHaveBeenCalled();
    expect(db.finish.update).toHaveBeenCalledWith(
      expect.objectContaining({ attempts: 0, status: 'pending' })
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
        {
          amount: 60,
          currency: 'NGN',
          gateway: 'paystack',
          metadata: { provider_refund_status: 'processed' },
        },
      ],
    });
    await expect(
      drainPaystackRefundNotifications(db as never, mocks.sendEmail)
    ).resolves.toEqual({
      claimed: 1,
      sent: 1,
      failed: 0,
      exhausted: 0,
      uncertain: 0,
    });
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
        {
          amount: 60,
          currency: 'NGN',
          gateway: 'paystack',
          metadata: { provider_refund_status: 'processed' },
        },
        {
          amount: 40,
          currency: 'NGN',
          gateway: 'paystack',
          metadata: {
            payment_transaction_id: 'payment-2',
            provider_refund_status: 'processed',
          },
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
          metadata: {
            payment_transaction_id: 'payment-1',
            provider_refund_status: 'processed',
          },
        },
      ],
    });
    await expect(
      drainPaystackRefundNotifications(db as never, mocks.sendEmail)
    ).resolves.toEqual({
      claimed: 1,
      sent: 1,
      failed: 0,
      exhausted: 0,
      uncertain: 0,
    });
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
          metadata: {
            payment_transaction_id: 'payment-1',
            provider_refund_status: 'processed',
          },
        },
        {
          amount: 40,
          currency: 'NGN',
          gateway: 'paystack',
          metadata: {
            payment_transaction_id: 'payment-2',
            provider_refund_status: 'processed',
          },
        },
      ],
    });
    await expect(
      drainPaystackRefundNotifications(db as never, mocks.sendEmail)
    ).resolves.toEqual({
      claimed: 1,
      sent: 1,
      failed: 0,
      exhausted: 0,
      uncertain: 0,
    });
    expect(mocks.sendEmail.mock.calls[0][0].textContent).toContain('100');
    expect(db.finish.update).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'sent' })
    );
  });

  it('folds dead-lettered rows into the exhausted failure signal', async () => {
    const db = database('processed_customer_email');
    db.finish.limit
      .mockResolvedValueOnce({ data: [], count: 0, error: null })
      .mockResolvedValueOnce({
        data: [{ event_type: 'processed_customer_email', order_id: 'order-7' }],
        count: 2,
        error: null,
      });

    const summary = await drainPaystackRefundNotifications(
      db as never,
      mocks.sendEmail
    );

    // Stale worker claims terminalize inside the claim call; the only
    // operational signal is this preflight count reaching the route.
    expect(summary.exhausted).toBe(2);
  });

  it('reports dead letters even when the send budget is zero', async () => {
    const db = database('processed_customer_email');
    db.finish.limit.mockResolvedValueOnce({
      data: [{ event_type: 'processed_customer_email', order_id: 'order-7' }],
      count: 2,
      error: null,
    });

    const summary = await drainPaystackRefundNotifications(
      db as never,
      mocks.sendEmail,
      0
    );

    // No send is admitted, but the dead letters are still permanently
    // undeliverable: suppressing the count would let the caller
    // return success while notifications rot.
    expect(summary).toEqual({
      claimed: 0,
      sent: 0,
      failed: 0,
      exhausted: 2,
      uncertain: 0,
    });
    expect(mocks.sendEmail).not.toHaveBeenCalled();
  });

  it('surfaces terminal rows the claim already moved out of every signal', async () => {
    const db = database('processed_customer_email');
    db.finish.limit
      .mockResolvedValueOnce({ data: [], count: 0, error: null })
      .mockResolvedValueOnce({ data: [], count: 0, error: null })
      .mockResolvedValueOnce({
        data: [{ event_type: 'failed_merchant_push', order_id: 'order-3' }],
        count: 1,
        error: null,
      });

    const summary = await drainPaystackRefundNotifications(
      db as never,
      mocks.sendEmail
    );

    // Terminal rows are no longer pre-transition, so exhausted stays
    // 0 — but they must not vanish: the uncertain count keeps them
    // visible in logs and payload until operations reviews them.
    expect(summary.exhausted).toBe(0);
    expect(summary.uncertain).toBe(1);
  });
});
