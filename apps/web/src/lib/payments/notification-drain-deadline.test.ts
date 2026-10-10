import { describe, expect, it } from 'vitest';
import { notificationDrainDeadlineMs } from './notification-drain-deadline';

describe('notificationDrainDeadlineMs', () => {
  it('reserves time for persisting the outcome before the route timeout', () => {
    expect(notificationDrainDeadlineMs(1_000_000)).toBe(1_270_000);
  });
});
