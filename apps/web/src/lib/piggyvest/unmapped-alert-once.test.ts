import { describe, expect, it, vi } from 'vitest';
import {
  alertOncePerEvent,
  resetUnmappedAlertMemoryForTests,
} from './unmapped-alert-once';

describe('alertOncePerEvent', () => {
  it('raises the alert once for repeated deliveries of the same event', () => {
    resetUnmappedAlertMemoryForTests();
    const emit = vi.fn();
    alertOncePerEvent('evt-1', emit);
    alertOncePerEvent('evt-1', emit);
    alertOncePerEvent('evt-1', emit);
    expect(emit).toHaveBeenCalledTimes(1);
  });

  it('raises a separate alert for a different event', () => {
    resetUnmappedAlertMemoryForTests();
    const emit = vi.fn();
    alertOncePerEvent('evt-1', emit);
    alertOncePerEvent('evt-2', emit);
    expect(emit).toHaveBeenCalledTimes(2);
  });

  it('tries again on the next delivery when the alert itself failed', () => {
    resetUnmappedAlertMemoryForTests();
    const emit = vi
      .fn()
      .mockImplementationOnce(() => {
        throw new Error('alert down');
      })
      .mockImplementation(() => undefined);
    expect(() => alertOncePerEvent('evt-1', emit)).toThrow('alert down');
    alertOncePerEvent('evt-1', emit);
    expect(emit).toHaveBeenCalledTimes(2);
  });

  it('forgets the oldest events once the memory is full', () => {
    resetUnmappedAlertMemoryForTests();
    const emit = vi.fn();
    for (let i = 0; i < 600; i += 1) alertOncePerEvent(`evt-${i}`, emit);
    emit.mockClear();
    alertOncePerEvent('evt-599', emit);
    expect(emit).not.toHaveBeenCalled();
    alertOncePerEvent('evt-0', emit);
    expect(emit).toHaveBeenCalledTimes(1);
  });
});
