import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';
import { act, renderHook } from '@testing-library/react-native';
import { useAppTrackingTransparency } from './use-app-tracking-transparency';
import {
  mockCanRequestTrackingTransparency,
  mockGetTrackingPermissionStatus,
  mockRecordCrashBreadcrumb,
  mockRequestTrackingPermission,
  mockTrackEvent,
  primeAttTrackingMocks,
} from './use-app-tracking-transparency.test-utils';

// jest.mock is hoisted above every import, so the hook under test binds to
// these mocks rather than the real native modules. The factories reference the
// imported `mock*` singletons (allowed by babel-plugin-jest-hoist) and only
// invoke them at call time, once the test-utils bindings have initialized.
jest.mock('@/lib/tracking-transparency', () => ({
  canRequestTrackingTransparency: () => mockCanRequestTrackingTransparency(),
  getTrackingPermissionStatus: () => mockGetTrackingPermissionStatus(),
}));

jest.mock('@/services/ad-tracking', () => ({
  requestTrackingPermission: () => mockRequestTrackingPermission(),
}));

jest.mock('@/lib/crash-diagnostics', () => ({
  recordCrashBreadcrumb: (...args: unknown[]) =>
    mockRecordCrashBreadcrumb(...args),
}));

jest.mock('@/services/analytics', () => ({
  trackEvent: (...args: unknown[]) => mockTrackEvent(...args),
}));

// The consent step ahead of the prompt has its own suite; here ads are off.
jest.mock('@/services/consent-before-tracking', () => ({
  gatherConsentBeforeTracking: async () => 'skipped',
}));

describe('bugfix: iOS silently discards ATT requests made during the launch transition (2.1.512 App Store rejection)', () => {
  const flushAttFlow = async () => {
    await act(async () => {
      await jest.advanceTimersByTimeAsync(0);
      await jest.advanceTimersByTimeAsync(0);
    });
  };

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    primeAttTrackingMocks();
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('retries the native request when iOS denies without recording a decision', async () => {
    // The rejection signature: request resolves 'denied' but the status
    // re-check still reads 'undetermined' — the dialog never displayed.
    mockRequestTrackingPermission
      .mockResolvedValueOnce('denied')
      .mockResolvedValueOnce('granted');

    const { result } = renderHook(() =>
      useAppTrackingTransparency({ enabled: true })
    );
    await flushAttFlow();

    expect(mockRequestTrackingPermission).toHaveBeenCalledTimes(1);
    expect(result.current.isTrackingAuthorizationSettled).toBe(false);
    expect(mockTrackEvent).toHaveBeenCalledWith('ATT Request Unrecorded', {
      attempt: '1',
    });

    await act(async () => {
      await jest.advanceTimersByTimeAsync(800);
    });

    expect(mockRequestTrackingPermission).toHaveBeenCalledTimes(2);
    expect(result.current.isTrackingAuthorizationSettled).toBe(true);
    expect(mockTrackEvent).toHaveBeenCalledWith('ATT Request Result', {
      status: 'granted',
    });
  });

  it('settles with the silent denial after exhausting the bounded retries', async () => {
    mockRequestTrackingPermission.mockResolvedValue('denied');

    const { result } = renderHook(() =>
      useAppTrackingTransparency({ enabled: true })
    );
    await flushAttFlow();

    expect(mockRequestTrackingPermission).toHaveBeenCalledTimes(1);

    for (const delay of [800, 1600, 2400]) {
      await act(async () => {
        await jest.advanceTimersByTimeAsync(delay);
      });
    }

    expect(mockRequestTrackingPermission).toHaveBeenCalledTimes(4);
    expect(result.current.isTrackingAuthorizationSettled).toBe(true);
    expect(mockTrackEvent).toHaveBeenCalledWith('ATT Request Unrecorded', {
      attempt: '3',
    });
    expect(mockTrackEvent).toHaveBeenCalledWith('ATT Request Result', {
      status: 'denied',
      recorded: 'false',
    });

    // No fifth request may remain scheduled once the retries are exhausted.
    await act(async () => {
      await jest.advanceTimersByTimeAsync(10_000);
    });
    expect(mockRequestTrackingPermission).toHaveBeenCalledTimes(4);
  });

  it('does not retry when the denial was genuinely recorded by iOS', async () => {
    mockGetTrackingPermissionStatus
      .mockResolvedValueOnce({ status: 'undetermined' })
      .mockResolvedValueOnce({ status: 'denied' });
    mockRequestTrackingPermission.mockResolvedValue('denied');

    const { result } = renderHook(() =>
      useAppTrackingTransparency({ enabled: true })
    );
    await flushAttFlow();

    expect(result.current.isTrackingAuthorizationSettled).toBe(true);
    expect(mockRequestTrackingPermission).toHaveBeenCalledTimes(1);
    expect(mockTrackEvent).toHaveBeenCalledWith('ATT Request Result', {
      status: 'denied',
      recorded: 'true',
    });
    expect(mockTrackEvent).not.toHaveBeenCalledWith(
      'ATT Request Unrecorded',
      expect.anything()
    );
  });

  it('clears a pending unrecorded-denial retry when the root unmounts', async () => {
    mockRequestTrackingPermission.mockResolvedValue('denied');

    const { unmount } = renderHook(() =>
      useAppTrackingTransparency({ enabled: true })
    );
    await flushAttFlow();

    expect(mockTrackEvent).toHaveBeenCalledWith('ATT Request Unrecorded', {
      attempt: '1',
    });
    unmount();

    await act(async () => {
      await jest.advanceTimersByTimeAsync(10_000);
    });
    expect(mockRequestTrackingPermission).toHaveBeenCalledTimes(1);
  });
});
