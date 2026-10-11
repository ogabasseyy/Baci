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
    // The hang starts mid-dispatch (probe fired): the deadline race
    // aborts a send the provider may have accepted, so uncertainty
    // — not a retryable failure — is the only honest outcome.
    const sendEmail = vi.fn(
      async (message: { beforeTransportDispatch?: () => Promise<void> }) => {
        await message.beforeTransportDispatch?.();
        await new Promise<never>(() => {});
      }
    );

    // 200s budget: above the full 135s four-attempt sender budget, so
    // the hanging send starts and the race persists uncertainty at the
    // deadline instead of reaching the route timeout.
    const draining = drainPaystackRefundNotifications(
      db as never,
      sendEmail as never,
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

  it('releases the customer email unattempted when only part of the sender budget remains', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    const db = database('processed_customer_email');
    const sendEmail = vi.fn();

    // 60s clears the row-claim floor and the old 20s admission check,
    // but not the full 135s four-attempt sender budget: starting the
    // loop would abort mid-send into delivery_uncertain, so the row
    // is released back to pending without burning the attempt the
    // claim just added — collapsing it to failed would dead-letter a
    // healthy notification after five tight-budget ticks.
    const result = await drainPaystackRefundNotifications(
      db as never,
      sendEmail,
      1,
      undefined,
      1_060_000
    );

    expect(result).toMatchObject({ claimed: 1, failed: 0, sent: 0 });
    expect(sendEmail).not.toHaveBeenCalled();
    expect(db.finish.update).toHaveBeenCalledWith(
      expect.objectContaining({
        attempts: 0,
        last_error: 'refund_notification_deadline_before_send',
        status: 'pending',
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
    expect(result).toEqual({
      claimed: 1,
      sent: 0,
      failed: 0,
      exhausted: 0,
      uncertain: 0,
    });
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
    expect(result).toEqual({
      claimed: 1,
      sent: 0,
      failed: 1,
      exhausted: 0,
      uncertain: 0,
    });
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

    expect(result).toEqual({
      claimed: 1,
      sent: 0,
      failed: 1,
      exhausted: 0,
      uncertain: 0,
    });
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

    expect(result).toEqual({
      claimed: 1,
      sent: 1,
      failed: 0,
      exhausted: 0,
      uncertain: 0,
    });
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

    expect(result).toEqual({
      claimed: 1,
      sent: 0,
      failed: 1,
      exhausted: 0,
      uncertain: 0,
    });
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

  it('restores a deferred release instead of parking it uncertain after finish errors', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    const db = database('processed_customer_email');
    const sendEmail = vi.fn();
    // Both finish writes error, but the row never attempted delivery:
    // the re-read proves it is still ours, so the pending release is
    // retried instead of parking a healthy row delivery_uncertain.
    db.finish.maybeSingle
      .mockResolvedValueOnce({
        data: null,
        error: { message: 'connection reset' },
      })
      .mockResolvedValueOnce({
        data: null,
        error: { message: 'connection reset' },
      })
      .mockResolvedValueOnce({
        data: { claim_token: 'claim-1', status: 'processing' },
        error: null,
      });

    const result = await drainPaystackRefundNotifications(
      db as never,
      sendEmail,
      1,
      undefined,
      1_060_000
    );

    expect(result).toEqual({
      claimed: 1,
      sent: 0,
      failed: 0,
      exhausted: 0,
      uncertain: 0,
    });
    expect(sendEmail).not.toHaveBeenCalled();
    expect(db.finish.update).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'pending' })
    );
    expect(db.finish.update).not.toHaveBeenCalledWith(
      expect.objectContaining({ status: 'delivery_uncertain' })
    );
  });

  it('leaves an unrecoverable deferred row processing instead of parking it', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    const db = database('processed_customer_email');
    const sendEmail = vi.fn();
    // Every write fails: the row stays processing for the stale-claim
    // sweep rather than terminalizing a never-attempted row as
    // delivery_uncertain, and the failure surfaces once.
    db.finish.maybeSingle
      .mockResolvedValueOnce({
        data: null,
        error: { message: 'connection reset' },
      })
      .mockResolvedValueOnce({
        data: null,
        error: { message: 'connection reset' },
      })
      .mockResolvedValueOnce({
        data: { claim_token: 'claim-1', status: 'processing' },
        error: null,
      })
      .mockResolvedValue({ data: null, error: { message: 'down' } });

    const result = await drainPaystackRefundNotifications(
      db as never,
      sendEmail,
      1,
      undefined,
      1_060_000
    );

    expect(result).toEqual({
      claimed: 1,
      sent: 0,
      failed: 1,
      exhausted: 0,
      uncertain: 0,
    });
    expect(sendEmail).not.toHaveBeenCalled();
    expect(db.finish.update).not.toHaveBeenCalledWith(
      expect.objectContaining({ status: 'delivery_uncertain' })
    );
  });

  it('skips the push and sends the capped email when only the email fits', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    const db = database('failed_merchant_push', 'paid');
    const sendEmail = vi.fn().mockResolvedValue({ success: true });
    const sendPush = vi.fn().mockResolvedValue({
      errors: [],
      failed: 0,
      sent: 0,
    });

    // 60s fits the 48s single-attempt email but not the 30s push
    // phase plus the email: starting the push would starve the
    // fallback and burn the attempt, so the push stands down and
    // the capped email sends directly.
    const result = await drainPaystackRefundNotifications(
      db as never,
      sendEmail,
      1,
      sendPush,
      1_060_000
    );

    expect(result).toMatchObject({ claimed: 1, sent: 1 });
    expect(sendPush).not.toHaveBeenCalled();
    expect(sendEmail).toHaveBeenCalledOnce();
    expect(sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({ maxAttemptsPerSender: 1 })
    );
  });

  it('releases both phases unattempted when even the capped email cannot fit', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    const db = database('failed_merchant_push', 'paid');
    const sendEmail = vi.fn();
    const sendPush = vi.fn().mockResolvedValue({
      errors: [],
      failed: 0,
      sent: 0,
    });

    // 46s clears the drain's 45s claim floor but fits neither the
    // push phase nor the 48s single-attempt email: both stand down
    // and the row releases back to pending without burning the
    // attempt instead of starting a send the deadline then aborts
    // into delivery_uncertain.
    const result = await drainPaystackRefundNotifications(
      db as never,
      sendEmail,
      1,
      sendPush,
      1_046_000
    );

    expect(result).toMatchObject({ claimed: 1, failed: 0, sent: 0 });
    expect(sendPush).not.toHaveBeenCalled();
    expect(sendEmail).not.toHaveBeenCalled();
    expect(db.finish.update).toHaveBeenCalledWith(
      expect.objectContaining({
        attempts: 0,
        last_error: 'refund_notification_deadline_before_send',
        status: 'pending',
      })
    );
  });
});
