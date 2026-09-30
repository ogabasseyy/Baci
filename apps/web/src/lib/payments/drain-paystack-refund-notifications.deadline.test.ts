import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  resolveContradictoryRefundFailure: vi.fn(),
}));

vi.mock('./resolve-contradictory-refund-failure', () => ({
  resolveContradictoryRefundFailure: mocks.resolveContradictoryRefundFailure,
}));

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

  it('requeues cleanly when a failure lands mid-claim', async () => {
    mocks.resolveContradictoryRefundFailure.mockResolvedValue(false);
    const db = database('failed_merchant_push');
    const sendEmail = vi.fn().mockResolvedValue({ success: true });
    const sendPush = vi.fn().mockResolvedValue({
      errors: [],
      failed: 0,
      sent: 1,
    });
    // The finish misses; the refetch proves the race (our claim
    // still held with a bumped generation); the requeue lands.
    db.finish.maybeSingle
      .mockResolvedValueOnce({ data: null, error: null })
      .mockResolvedValueOnce({
        data: {
          claim_token: 'claim-1',
          generation: 1,
          status: 'processing',
        },
        error: null,
      })
      .mockResolvedValueOnce({ data: { id: 'notification-1' }, error: null });

    const result = await drainPaystackRefundNotifications(
      db as never,
      sendEmail,
      1,
      sendPush
    );

    // The stale conclusion is discarded without counting a failure:
    // the next sweep re-evaluates with the fresh contradiction.
    expect(result).toEqual({ claimed: 1, sent: 0, failed: 0, exhausted: 0 });
    expect(db.finish.update).toHaveBeenCalledTimes(2);
    expect(db.finish.update).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        claim_token: null,
        last_error: null,
        status: 'pending',
        // The fresh generation restarts the retry budget: without the
        // reset the claim RPC would dead-letter a fifth-claim requeue
        // instead of delivering the new failure alert.
        attempts: 0,
      })
    );
    expect(db.finish.gt).toHaveBeenCalledWith('generation', 0);
  });

  it('parks the row instead of requeueing when the race is unproven', async () => {
    const db = database('processed_customer_email');
    const sendEmail = vi.fn().mockResolvedValue({ success: true });
    // The finish misses but the refetch shows our own claim with the
    // same generation: an ambiguous write, not a mid-claim failure.
    db.finish.maybeSingle
      .mockResolvedValueOnce({ data: null, error: null })
      .mockResolvedValueOnce({
        data: {
          claim_token: 'claim-1',
          generation: 0,
          status: 'processing',
        },
        error: null,
      })
      .mockResolvedValue({ data: null, error: null });

    const result = await drainPaystackRefundNotifications(
      db as never,
      sendEmail,
      1,
      undefined
    );

    // No requeue: a second sweep could re-send an email the lost
    // finish already concluded. The row parks as delivery_uncertain
    // and the failure surfaces once.
    expect(result).toEqual({ claimed: 1, sent: 0, failed: 1, exhausted: 0 });
    expect(db.finish.update).toHaveBeenCalledTimes(2);
    expect(db.finish.update).not.toHaveBeenCalledWith(
      expect.objectContaining({ status: 'pending' })
    );
    expect(db.finish.update).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        last_error: 'refund_notification_finish_unconfirmed',
        status: 'delivery_uncertain',
      })
    );
  });

  it('counts a failure when neither finish nor requeue lands', async () => {
    const db = database('processed_customer_email');
    const sendEmail = vi.fn().mockResolvedValue({ success: true });
    db.finish.maybeSingle.mockResolvedValue({ data: null, error: null });

    const result = await drainPaystackRefundNotifications(
      db as never,
      sendEmail,
      1,
      undefined
    );

    expect(result).toEqual({ claimed: 1, sent: 0, failed: 1, exhausted: 0 });
    expect(db.finish.update).toHaveBeenCalledTimes(2);
  });

  it('retries the known outcome after a finish write error', async () => {
    const db = database('processed_customer_email');
    const sendEmail = vi.fn().mockResolvedValue({ success: true });
    // The first finish errors (the write may still have persisted
    // unseen); the retry lands, so the known outcome counts with no
    // requeue and no second send.
    db.finish.maybeSingle.mockResolvedValueOnce({
      data: null,
      error: { message: 'connection reset' },
    });

    const result = await drainPaystackRefundNotifications(
      db as never,
      sendEmail,
      1,
      undefined
    );

    expect(result).toEqual({ claimed: 1, sent: 1, failed: 0, exhausted: 0 });
    expect(sendEmail).toHaveBeenCalledOnce();
    expect(db.finish.update).toHaveBeenCalledTimes(2);
    expect(db.finish.update).not.toHaveBeenCalledWith(
      expect.objectContaining({ status: 'pending' })
    );
  });

  it('parks the row when the finish retry also errors', async () => {
    const db = database('processed_customer_email');
    const sendEmail = vi.fn().mockResolvedValue({ success: true });
    // Both finish attempts error: the outcome may have persisted
    // unseen, so the row parks as delivery_uncertain instead of
    // requeueing into a second send.
    db.finish.maybeSingle
      .mockResolvedValueOnce({
        data: null,
        error: { message: 'connection reset' },
      })
      .mockResolvedValueOnce({
        data: null,
        error: { message: 'connection reset' },
      })
      .mockResolvedValue({ data: null, error: null });

    const result = await drainPaystackRefundNotifications(
      db as never,
      sendEmail,
      1,
      undefined
    );

    expect(result).toEqual({ claimed: 1, sent: 0, failed: 1, exhausted: 0 });
    expect(sendEmail).toHaveBeenCalledOnce();
    expect(db.finish.update).toHaveBeenCalledTimes(3);
    expect(db.finish.update).not.toHaveBeenCalledWith(
      expect.objectContaining({ status: 'pending' })
    );
    expect(db.finish.update).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        last_error: 'refund_notification_finish_unconfirmed',
        status: 'delivery_uncertain',
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
