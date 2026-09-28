import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  assertRefundNotificationSendTime,
  awaitRefundNotificationDeadline,
} from './await-refund-notification-deadline';

describe('refund notification deadline', () => {
  afterEach(() => vi.useRealTimers());

  it('passes through work without a deadline', async () => {
    expect(await awaitRefundNotificationDeadline(Promise.resolve('sent'))).toBe(
      'sent'
    );
    expect(() => assertRefundNotificationSendTime()).not.toThrow();
  });

  it('rejects a send when too little time remains', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    expect(() => assertRefundNotificationSendTime(Date.now() + 19_999)).toThrow(
      'refund_notification_deadline_before_send'
    );
    expect(() =>
      assertRefundNotificationSendTime(Date.now() + 20_000)
    ).not.toThrow();
  });

  it('stops waiting with time left to persist an uncertain outcome', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    const waiting = awaitRefundNotificationDeadline(
      new Promise<never>(() => {}),
      1_030_000
    );
    const rejected = expect(waiting).rejects.toThrow(
      'refund_notification_delivery_deadline'
    );

    await vi.advanceTimersByTimeAsync(20_000);
    await rejected;
  });

  it('clears the deadline timer after work settles', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    const clear = vi.spyOn(globalThis, 'clearTimeout');

    expect(
      await awaitRefundNotificationDeadline(Promise.resolve('sent'), 1_030_000)
    ).toBe('sent');
    expect(clear).toHaveBeenCalledOnce();
  });
});
