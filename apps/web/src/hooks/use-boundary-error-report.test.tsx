import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useBoundaryErrorReport } from './use-boundary-error-report';

const mockCaptureClientException = vi.fn();
const mockIsChunkLoadRecoveryPending = vi.fn();
const mockAttemptChunkLoadRecoveryFromBoundary = vi.fn();

vi.mock('@/lib/posthog/client-exceptions', () => ({
  captureClientException: (...args: unknown[]) =>
    mockCaptureClientException(...args),
}));

vi.mock('@/lib/chunk-load-recovery', () => ({
  attemptChunkLoadRecoveryFromBoundary: (...args: unknown[]) =>
    mockAttemptChunkLoadRecoveryFromBoundary(...args),
  isChunkLoadRecoveryPending: (...args: unknown[]) =>
    mockIsChunkLoadRecoveryPending(...args),
}));

describe('useBoundaryErrorReport', () => {
  beforeEach(() => {
    mockCaptureClientException.mockReset();
    mockIsChunkLoadRecoveryPending.mockReset().mockReturnValue(false);
    mockAttemptChunkLoadRecoveryFromBoundary.mockReset();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  it('returns false and captures the exception with recovery_action "none" for a non-chunk error', async () => {
    const error = new Error('boom');

    const { result } = renderHook(() =>
      useBoundaryErrorReport(error, {
        logLabel: 'Dashboard error',
        routeSurface: 'dashboard',
      })
    );

    expect(result.current).toBe(false);
    await vi.waitFor(() => {
      expect(mockCaptureClientException).toHaveBeenCalledTimes(1);
    });
    expect(mockCaptureClientException).toHaveBeenCalledWith(
      error,
      expect.objectContaining({
        recovery_action: 'none',
        route_surface: 'dashboard',
      })
    );
  });

  it('does not capture a second time when re-rendered with the same error instance', async () => {
    const error = new Error('boom');

    const { rerender } = renderHook(
      ({ currentError }) =>
        useBoundaryErrorReport(currentError, {
          logLabel: 'Dashboard error',
          routeSurface: 'dashboard',
        }),
      { initialProps: { currentError: error } }
    );

    await vi.waitFor(() => {
      expect(mockCaptureClientException).toHaveBeenCalledTimes(1);
    });

    rerender({ currentError: error });
    await Promise.resolve();

    expect(mockCaptureClientException).toHaveBeenCalledTimes(1);
  });

  it('captures again when a new error instance is passed', async () => {
    const firstError = new Error('first');
    const secondError = new Error('second');

    const { rerender } = renderHook(
      ({ currentError }) =>
        useBoundaryErrorReport(currentError, {
          logLabel: 'Dashboard error',
          routeSurface: 'dashboard',
        }),
      { initialProps: { currentError: firstError } }
    );

    await vi.waitFor(() => {
      expect(mockCaptureClientException).toHaveBeenCalledTimes(1);
    });

    rerender({ currentError: secondError });

    await vi.waitFor(() => {
      expect(mockCaptureClientException).toHaveBeenCalledTimes(2);
    });
    expect(mockCaptureClientException).toHaveBeenLastCalledWith(
      secondError,
      expect.objectContaining({ recovery_action: 'none' })
    );
  });

  it('returns true, attempts recovery, and captures with recovery_action "reload-scheduled" for a pending chunk error', async () => {
    mockIsChunkLoadRecoveryPending.mockReturnValue(true);
    mockAttemptChunkLoadRecoveryFromBoundary.mockReturnValue(true);
    const error = new Error('Loading chunk 4 failed');

    const { result } = renderHook(() =>
      useBoundaryErrorReport(error, {
        logLabel: 'Checkout error',
        routeSurface: 'checkout',
      })
    );

    expect(result.current).toBe(true);
    expect(mockAttemptChunkLoadRecoveryFromBoundary).toHaveBeenCalledWith(
      error
    );
    await vi.waitFor(() => {
      expect(mockCaptureClientException).toHaveBeenCalledWith(
        error,
        expect.objectContaining({
          recovery_action: 'reload-scheduled',
          route_surface: 'checkout',
        })
      );
    });
  });

  it('captures with recovery_action "none" when the recovery attempt is declined', async () => {
    mockIsChunkLoadRecoveryPending.mockReturnValue(true);
    mockAttemptChunkLoadRecoveryFromBoundary.mockReturnValue(false);
    const error = new Error('Loading chunk 5 failed');

    const { result } = renderHook(() =>
      useBoundaryErrorReport(error, {
        logLabel: 'Checkout error',
        routeSurface: 'checkout',
      })
    );

    expect(result.current).toBe(false);
    await vi.waitFor(() => {
      expect(mockCaptureClientException).toHaveBeenCalledWith(
        error,
        expect.objectContaining({ recovery_action: 'none' })
      );
    });
  });

  it('logs the error to the console with the provided logLabel', () => {
    const consoleErrorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const error = new Error('boom');

    renderHook(() =>
      useBoundaryErrorReport(error, {
        logLabel: 'Admin error',
        routeSurface: 'admin',
      })
    );

    expect(consoleErrorSpy).toHaveBeenCalledWith('Admin error:', error);
  });
});
