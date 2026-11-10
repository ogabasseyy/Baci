import { act, cleanup } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, beforeEach, expect, vi } from 'vitest';

/** Keep real input-otp callbacks inside the test's DOM lifetime. */
export function installOxygenOtpTestEnvironment() {
  beforeAll(() => {
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe = vi.fn();
        unobserve = vi.fn();
        disconnect = vi.fn();
      }
    );
  });
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });
  afterEach(async () => {
    try {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(60);
      });
      cleanup();
      await act(async () => {
        await vi.runOnlyPendingTimersAsync();
      });
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
  afterAll(() => vi.unstubAllGlobals());
}
