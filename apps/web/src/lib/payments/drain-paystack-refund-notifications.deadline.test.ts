import { afterEach, describe, expect, it, vi } from 'vitest';
import { drainPaystackRefundNotifications } from './drain-paystack-refund-notifications';
import { database } from './drain-paystack-refund-notifications.test-support';

describe('refund notification cron deadline', () => {
  afterEach(() => vi.useRealTimers());

  it('leaves a row unclaimed when there is too little time to send', async () => {
    const db = database('processed_customer_email');
    const sendEmail = vi.fn();

    const result = await drainPaystackRefundNotifications(
      db as never,
      sendEmail,
      1,
      undefined,
      Date.now() + 30_000
    );

    expect(result.claimed).toBe(0);
    expect(db.rpc).not.toHaveBeenCalled();
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('persists uncertainty before a hanging mail send reaches the route timeout', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    const db = database('processed_customer_email');
    const sendEmail = vi.fn(() => new Promise<never>(() => {}));

    // 200s budget: above the full 135s four-attempt sender budget, so
    // the hanging send starts and the race persists uncertainty at the
    // deadline instead of reaching the route timeout.
    const draining = drainPaystackRefundNotifications(
      db as never,
      sendEmail,
      1,
      undefined,
      1_200_000
    );
    await vi.waitFor(() => expect(sendEmail).toHaveBeenCalledOnce());
    await vi.advanceTimersByTimeAsync(201_000);
    const result = await draining;

    expect(result).toMatchObject({ claimed: 1, failed: 1 });
    expect(db.finish.update).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'delivery_uncertain' })
    );
  });

  it('refuses the customer email when only part of the sender budget remains', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    const db = database('processed_customer_email');
    const sendEmail = vi.fn();

    // 60s clears the row-claim floor and the old 20s admission check,
    // but not the full 135s four-attempt sender budget: starting the
    // loop would abort mid-send into delivery_uncertain, so the row
    // fails retryably instead.
    const result = await drainPaystackRefundNotifications(
      db as never,
      sendEmail,
      1,
      undefined,
      1_060_000
    );

    expect(result).toMatchObject({ claimed: 1, failed: 1 });
    expect(sendEmail).not.toHaveBeenCalled();
    expect(db.finish.update).toHaveBeenCalledWith(
      expect.objectContaining({
        last_error: 'refund_notification_deadline_before_send',
        status: 'failed',
      })
    );
  });

  it('refuses the merchant-email fallback after push consumed the sender budget', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    const db = database('failed_merchant_push', 'paid');
    const sendEmail = vi.fn();
    const sendPush = vi.fn().mockResolvedValue({
      errors: [],
      failed: 0,
      sent: 0,
    });

    // 60s admits the push attempt but not the uncapped email loop
    // behind it: the fallback must yield retryably, not start a send
    // the deadline then aborts into delivery_uncertain.
    const result = await drainPaystackRefundNotifications(
      db as never,
      sendEmail,
      1,
      sendPush,
      1_060_000
    );

    expect(result).toMatchObject({ claimed: 1, failed: 1 });
    expect(sendPush).toHaveBeenCalledOnce();
    expect(sendEmail).not.toHaveBeenCalled();
    expect(db.finish.update).toHaveBeenCalledWith(
      expect.objectContaining({
        last_error: 'refund_notification_deadline_before_send',
        status: 'failed',
      })
    );
  });
});
