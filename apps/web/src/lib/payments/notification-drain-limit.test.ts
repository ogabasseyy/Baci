import { describe, expect, it } from 'vitest';
import {
  notificationDrainDeadlineMs,
  notificationDrainLimit,
} from './notification-drain-limit';

describe('notificationDrainLimit', () => {
  it('drains the worst-case batch when the workers were fast', () => {
    // ZeptoMail may make four 30-second attempts plus backoff.
    expect(notificationDrainLimit(0)).toBe(1);
    expect(notificationDrainLimit(60_000)).toBe(1);
  });

  it('shrinks the batch as the invocation budget burns down', () => {
    expect(notificationDrainLimit(120_000)).toBe(1);
    expect(notificationDrainLimit(200_000)).toBe(0);
  });

  it('reserves time for persisting the outcome before the route timeout', () => {
    expect(notificationDrainDeadlineMs(1_000_000)).toBe(1_270_000);
  });

  it('skips the drain when no send fits safely', () => {
    expect(notificationDrainLimit(270_000)).toBe(0);
    expect(notificationDrainLimit(400_000)).toBe(0);
  });
});
