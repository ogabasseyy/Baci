import { afterEach, describe, expect, it, vi } from 'vitest';
import { scheduleLagosMidnightRefresh } from './schedule-lagos-midnight-refresh';

describe('scheduleLagosMidnightRefresh', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('refreshes at the next Africa/Lagos midnight and can be cancelled', () => {
    vi.useFakeTimers({ now: new Date('2024-01-10T22:30:00Z') });
    const onRefresh = vi.fn();
    const cancel = scheduleLagosMidnightRefresh(onRefresh);

    vi.advanceTimersByTime(30 * 60 * 1000 - 1);
    expect(onRefresh).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onRefresh).toHaveBeenCalledOnce();

    cancel();
    vi.advanceTimersByTime(24 * 60 * 60 * 1000);
    expect(onRefresh).toHaveBeenCalledOnce();
  });
});
