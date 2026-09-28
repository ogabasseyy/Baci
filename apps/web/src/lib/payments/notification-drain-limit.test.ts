import { describe, expect, it } from 'vitest';
import { notificationDrainLimit } from './notification-drain-limit';

describe('notificationDrainLimit', () => {
  it('drains the worst-case batch when the workers were fast', () => {
    // 270s after the margin fits nine 30s worst-case sends.
    expect(notificationDrainLimit(0)).toBe(9);
    expect(notificationDrainLimit(60_000)).toBe(7);
  });

  it('shrinks the batch as the invocation budget burns down', () => {
    // 200s of worker time leaves 70s after the margin: 2 sends fit.
    expect(notificationDrainLimit(200_000)).toBe(2);
  });

  it('skips the drain when no send fits safely', () => {
    expect(notificationDrainLimit(270_000)).toBe(0);
    expect(notificationDrainLimit(400_000)).toBe(0);
  });
});
