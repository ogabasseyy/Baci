import { beforeEach, describe, expect, it, vi } from 'vitest';
import { drainPaystackRefundNotifications } from './drain-paystack-refund-notifications';
import { database } from './drain-paystack-refund-notifications.test-support';

const sendEmail = vi.fn();
const sendPush = vi.fn();

describe('merchant refund app notification', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sendEmail.mockResolvedValue({ success: true });
  });

  it('pushes a verified refund update to the merchant', async () => {
    const db = database('processed_merchant_push');
    sendPush.mockResolvedValue({ sent: 1, failed: 0, errors: [] });

    await expect(
      drainPaystackRefundNotifications(db as never, sendEmail, 1, sendPush)
    ).resolves.toEqual({ claimed: 1, sent: 1, failed: 0, exhausted: 0 });

    expect(sendPush).toHaveBeenCalledWith(
      'merchant-1',
      'Refund processed',
      expect.stringContaining('order #ORD-1'),
      expect.objectContaining({
        type: 'paystack_refund_processed',
        order_id: 'order-1',
      }),
      'payments'
    );
    expect(sendEmail).not.toHaveBeenCalled();
    expect(db.finish.update).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'sent' })
    );
  });

  it('falls back to merchant email when there is no active app token', async () => {
    const db = database('failed_merchant_push', 'paid');
    sendPush.mockResolvedValue({ sent: 0, failed: 0, errors: [] });

    await drainPaystackRefundNotifications(db as never, sendEmail, 1, sendPush);

    expect(sendPush).toHaveBeenCalledWith(
      'merchant-1',
      'Refund needs attention',
      expect.any(String),
      expect.any(Object),
      'payments'
    );
    expect(sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'merchant@example.com' })
    );
  });

  it('holds a partly delivered push for review without sending a duplicate email', async () => {
    const db = database('processed_merchant_push');
    sendPush.mockResolvedValue({ sent: 1, failed: 1, errors: ['timeout'] });

    await expect(
      drainPaystackRefundNotifications(db as never, sendEmail, 1, sendPush)
    ).resolves.toEqual({ claimed: 1, sent: 0, failed: 1, exhausted: 0 });

    expect(sendEmail).not.toHaveBeenCalled();
    expect(db.finish.update).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'delivery_uncertain' })
    );
  });

  it('falls back to email when the token lookup failed before sending', async () => {
    const db = database('processed_merchant_push');
    sendPush.mockResolvedValue({
      sent: 0,
      failed: 0,
      errors: ['token lookup failed'],
    });

    await expect(
      drainPaystackRefundNotifications(db as never, sendEmail, 1, sendPush)
    ).resolves.toEqual({ claimed: 1, sent: 1, failed: 0, exhausted: 0 });

    expect(sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'merchant@example.com' })
    );
    expect(db.finish.update).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'sent' })
    );
  });

  it('falls back to email after an explicit zero-send rejection', async () => {
    const db = database('processed_merchant_push');
    sendPush.mockResolvedValue({ sent: 0, failed: 1, errors: ['rejected'] });

    await expect(
      drainPaystackRefundNotifications(db as never, sendEmail, 1, sendPush)
    ).resolves.toEqual({ claimed: 1, sent: 1, failed: 0, exhausted: 0 });

    expect(sendEmail).toHaveBeenCalledTimes(1);
  });

  it('holds an unknown zero-send result for review', async () => {
    const db = database('processed_merchant_push');
    sendPush.mockResolvedValue({
      sent: 0,
      failed: 1,
      errors: ['network timeout'],
      deliveryOutcome: 'unknown',
    });

    await expect(
      drainPaystackRefundNotifications(db as never, sendEmail, 1, sendPush)
    ).resolves.toEqual({ claimed: 1, sent: 0, failed: 1, exhausted: 0 });

    expect(sendEmail).not.toHaveBeenCalled();
    expect(db.finish.update).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'delivery_uncertain' })
    );
  });
});
