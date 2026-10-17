import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useDeferredValidationActivation } from './use-deferred-validation-activation';

describe('useDeferredValidationActivation', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('activates on idle after load when deferred', async () => {
    vi.useFakeTimers();
    const onActivate = vi.fn();
    renderHook(() =>
      useDeferredValidationActivation({
        deferValidationUntilIdle: true,
        idleValidationActivated: false,
        validationActivationTimeoutMs: 1000,
        onActivate,
      })
    );
    await act(async () => {
      vi.advanceTimersByTime(1100);
    });
    expect(onActivate).toHaveBeenCalledWith(true);
  });

  it('does not activate when not deferred or already activated', async () => {
    vi.useFakeTimers();
    const onActivate = vi.fn();
    renderHook(() =>
      useDeferredValidationActivation({
        deferValidationUntilIdle: false,
        idleValidationActivated: false,
        validationActivationTimeoutMs: 1000,
        onActivate,
      })
    );
    await act(async () => {
      vi.advanceTimersByTime(2000);
    });
    expect(onActivate).not.toHaveBeenCalled();
  });

  it('cancels activation on unmount', async () => {
    vi.useFakeTimers();
    const onActivate = vi.fn();
    const { unmount } = renderHook(() =>
      useDeferredValidationActivation({
        deferValidationUntilIdle: true,
        idleValidationActivated: false,
        validationActivationTimeoutMs: 1000,
        onActivate,
      })
    );
    unmount();
    await act(async () => {
      vi.advanceTimersByTime(2000);
    });
    expect(onActivate).not.toHaveBeenCalled();
  });
});
