import { afterEach, describe, expect, it, vi } from 'vitest';
import { assertRefundNotificationSendTime } from './assert-refund-notification-send-time';

describe('assertRefundNotificationSendTime', () => {
  afterEach(() => vi.useRealTimers());

  it('passes without a deadline', () => {
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
});
