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

    const draining = drainPaystackRefundNotifications(
      db as never,
      sendEmail,
      1,
      undefined,
      1_060_000
    );
    await vi.waitFor(() => expect(sendEmail).toHaveBeenCalledOnce());
    await vi.advanceTimersByTimeAsync(50_000);
    const result = await draining;

    expect(result).toMatchObject({ claimed: 1, failed: 1 });
    expect(db.finish.update).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'delivery_uncertain' })
    );
  });
});
